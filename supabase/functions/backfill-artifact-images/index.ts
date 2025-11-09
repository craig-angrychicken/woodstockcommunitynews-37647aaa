import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.80.0';

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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting artifact images backfill...');

    // Fetch all artifacts that either have no images field or empty images array
    const { data: artifacts, error: fetchError } = await supabase
      .from('artifacts')
      .select('id, guid, content, images')
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('Error fetching artifacts:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${artifacts?.length || 0} artifacts to process`);

    let updatedCount = 0;
    let skippedCount = 0;

    // Process each artifact
    for (const artifact of artifacts || []) {
      // Skip if images already populated
      if (artifact.images && Array.isArray(artifact.images) && artifact.images.length > 0) {
        skippedCount++;
        continue;
      }

      if (!artifact.content) {
        skippedCount++;
        continue;
      }

      // Extract Supabase storage URLs from content
      // Pattern: https://[project].supabase.co/storage/v1/object/public/artifact-images/[guid]/[filename]
      const storageUrlPattern = new RegExp(
        `https://${supabaseUrl.split('//')[1]}/storage/v1/object/public/artifact-images/${artifact.guid}/[^\\s\\)\\]]+`,
        'g'
      );

      const imageUrls = artifact.content.match(storageUrlPattern) || [];

      if (imageUrls.length > 0) {
        // Remove duplicates
        const uniqueUrls = [...new Set(imageUrls)];

        // Create images array with stored URLs
        const imagesArray = uniqueUrls.map(url => ({
          original_url: '',
          stored_url: url
        }));

        // Update artifact with images
        const { error: updateError } = await supabase
          .from('artifacts')
          .update({ images: imagesArray })
          .eq('id', artifact.id);

        if (updateError) {
          console.error(`Error updating artifact ${artifact.id}:`, updateError);
        } else {
          updatedCount++;
          console.log(`Updated artifact ${artifact.id} with ${uniqueUrls.length} images`);
        }
      } else {
        skippedCount++;
      }
    }

    const result = {
      success: true,
      totalProcessed: artifacts?.length || 0,
      updatedCount,
      skippedCount,
      message: `Backfill complete: ${updatedCount} artifacts updated, ${skippedCount} skipped`
    };

    console.log('Backfill complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Error in backfill-artifact-images function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
