import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔍 Starting image backfill process...');

    // Parse request body for optional filters
    const { artifactIds, sourceIds, dateFrom } = await req.json().catch(() => ({}));

    // Build query for artifacts missing images
    let query = supabase
      .from('artifacts')
      .select('id, guid, images, source_id, name, created_at')
      .is('hero_image_url', null);

    if (artifactIds?.length) {
      query = query.in('id', artifactIds);
    }
    if (sourceIds?.length) {
      query = query.in('source_id', sourceIds);
    }
    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }

    query = query.order('created_at', { ascending: false }).limit(100);

    const { data: artifacts, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch artifacts: ${fetchError.message}`);
    }

    console.log(`📊 Found ${artifacts?.length || 0} artifacts with missing images`);

    let recovered = 0;
    let failed = 0;
    const problematicDomains = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com'];

    for (const artifact of artifacts || []) {
      try {
        console.log(`\n🔄 Processing artifact: ${artifact.name} (${artifact.id})`);
        
        // Parse images array from JSONB
        const imageUrls = Array.isArray(artifact.images) ? artifact.images : [];
        
        if (imageUrls.length === 0) {
          console.log(`⏭️ No image URLs found in images array, skipping`);
          failed++;
          continue;
        }

        const storageImages: string[] = [];
        
        for (let i = 0; i < imageUrls.length; i++) {
          const imageUrl = imageUrls[i];
          
          // Validate URL
          try {
            new URL(imageUrl);
          } catch {
            console.warn(`⚠️ Invalid URL format: ${imageUrl}`);
            continue;
          }

          // Check for problematic domains
          const isProblematic = problematicDomains.some(domain => imageUrl.includes(domain));
          if (isProblematic) {
            console.warn(`⚠️ Protected social media URL: ${imageUrl}`);
          }

          // Attempt download with retry logic
          let imgResponse: Response | null = null;
          let lastError: Error | null = null;

          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const imgController = new AbortController();
              const imgTimeoutId = setTimeout(() => imgController.abort(), 30000);

              imgResponse = await fetch(imageUrl, {
                signal: imgController.signal,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; ImageBackfill/1.0)',
                  'Accept': 'image/*'
                }
              });
              clearTimeout(imgTimeoutId);

              if (imgResponse.ok) break;

              if (imgResponse.status === 403) {
                console.error(`🔒 Protected (403): ${imageUrl}`);
                lastError = new Error(`Protected URL`);
                break;
              }

              lastError = new Error(`HTTP ${imgResponse.status}`);
            } catch (err) {
              lastError = err instanceof Error ? err : new Error('Unknown error');
            }

            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
          }

          if (!imgResponse || !imgResponse.ok) {
            console.error(`❌ Failed to download image: ${imageUrl}`);
            continue;
          }

          // Download and upload
          const imageBuffer = await imgResponse.arrayBuffer();
          const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
          
          if (!contentType.startsWith('image/')) {
            console.error(`❌ Invalid content type: ${contentType}`);
            continue;
          }

          const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
          const storagePath = `${artifact.guid}/image-${i}.${ext}`;

          const { error: uploadError } = await supabase.storage
            .from('artifact-images')
            .upload(storagePath, imageBuffer, {
              contentType,
              upsert: true
            });

          if (uploadError) {
            console.error(`❌ Upload error:`, uploadError);
            continue;
          }

          const { data: urlData } = supabase.storage
            .from('artifact-images')
            .getPublicUrl(storagePath);

          if (urlData?.publicUrl) {
            storageImages.push(urlData.publicUrl);
            console.log(`✅ Recovered image ${i + 1}: ${urlData.publicUrl}`);
          }
        }

        // Update artifact if we recovered any images
        if (storageImages.length > 0) {
          const { error: updateError } = await supabase
            .from('artifacts')
            .update({
              hero_image_url: storageImages[0],
              images: storageImages
            })
            .eq('id', artifact.id);

          if (updateError) {
            console.error(`❌ Failed to update artifact:`, updateError);
            failed++;
          } else {
            console.log(`✅ Updated artifact with ${storageImages.length} images`);
            recovered++;
          }
        } else {
          console.log(`❌ No images could be recovered for this artifact`);
          failed++;
        }

      } catch (error) {
        console.error(`❌ Error processing artifact ${artifact.id}:`, error);
        failed++;
      }
    }

    const summary = {
      success: true,
      totalProcessed: artifacts?.length || 0,
      recovered,
      failed,
      message: `Backfill complete: ${recovered} recovered, ${failed} failed`
    };

    console.log('\n📊 Summary:', summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('❌ Fatal error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
