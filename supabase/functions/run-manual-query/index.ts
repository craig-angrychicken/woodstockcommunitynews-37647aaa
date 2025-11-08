import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      dateFrom,
      dateTo,
      sourceIds,
      environment,
      promptVersionId,
      runStages,
      historyId
    } = await req.json();

    console.log('Starting manual query run:', {
      dateFrom,
      dateTo,
      sourceIds,
      environment,
      promptVersionId,
      runStages
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const isTest = environment === 'test';
    let artifactsCount = 0;
    let storiesCount = 0;

    // Stage 1: Fetch sources and create artifacts
    console.log('Stage 1: Fetching sources and creating artifacts...');
    
    // Get source details
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', sourceIds);

    if (sourcesError) throw sourcesError;

    // Simulate fetching from sources and create artifacts
    for (const source of sources) {
      // In real implementation, this would fetch actual data from the source
      // For now, we'll create mock artifacts
      const mockArtifacts = Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, i) => ({
        name: `${source.name}-artifact-${i + 1}`,
        title: `Article from ${source.name} - ${new Date().toISOString()}`,
        type: source.type,
        content: `Mock content fetched from ${source.name}`,
        size_mb: Math.random() * 2,
        source_id: source.id,
        date: new Date().toISOString()
      }));

      const { error: insertError } = await supabase
        .from('artifacts')
        .insert(mockArtifacts);

      if (insertError) {
        console.error('Error inserting artifacts:', insertError);
      } else {
        artifactsCount += mockArtifacts.length;
      }

      // Update source's last_fetch_at
      await supabase
        .from('sources')
        .update({
          last_fetch_at: new Date().toISOString(),
          items_fetched: mockArtifacts.length
        })
        .eq('id', source.id);
    }

    console.log(`Stage 1 complete: Created ${artifactsCount} artifacts`);

    // Stage 2: Generate stories using AI (if requested)
    if (runStages === 'both') {
      console.log('Stage 2: Generating stories with AI...');

      // Get prompt version
      const { data: promptVersion, error: promptError } = await supabase
        .from('prompt_versions')
        .select('*')
        .eq('id', promptVersionId)
        .single();

      if (promptError) throw promptError;

      // Get recent artifacts to generate stories from
      const { data: recentArtifacts, error: artifactsError } = await supabase
        .from('artifacts')
        .select('*')
        .in('source_id', sourceIds)
        .order('created_at', { ascending: false })
        .limit(10);

      if (artifactsError) throw artifactsError;

      // Generate stories from artifacts using AI
      for (const artifact of recentArtifacts) {
        const aiPrompt = `${promptVersion.content}\n\nSource material:\nTitle: ${artifact.title}\nContent: ${artifact.content}\n\nGenerate a news article based on this source material.`;

        try {
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'You are a professional news article writer.' },
                { role: 'user', content: aiPrompt }
              ],
            }),
          });

          if (!aiResponse.ok) {
            if (aiResponse.status === 429) {
              console.error('Rate limit exceeded');
              continue;
            }
            if (aiResponse.status === 402) {
              console.error('Payment required - out of credits');
              break;
            }
            throw new Error(`AI API error: ${aiResponse.status}`);
          }

          const aiData = await aiResponse.json();
          const generatedContent = aiData.choices[0].message.content;

          // Create story
          const { data: newStory, error: storyError } = await supabase
            .from('stories')
            .insert({
              title: artifact.title,
              content: generatedContent,
              status: 'pending',
              is_test: isTest,
              environment,
              article_type: 'full',
              prompt_version_id: promptVersion.version_name,
              source_id: artifact.source_id
            })
            .select()
            .single();

          if (storyError) {
            console.error('Error creating story:', storyError);
            continue;
          }

          // Link artifact to story
          await supabase
            .from('story_artifacts')
            .insert({
              story_id: newStory.id,
              artifact_id: artifact.id
            });

          storiesCount++;
          console.log(`Created story: ${newStory.title}`);
        } catch (aiError) {
          console.error('Error generating story with AI:', aiError);
        }
      }

      console.log(`Stage 2 complete: Generated ${storiesCount} stories`);
    }

    // Update query history
    const { error: historyError } = await supabase
      .from('query_history')
      .update({
        status: 'completed',
        artifacts_count: artifactsCount,
        stories_count: storiesCount,
        completed_at: new Date().toISOString()
      })
      .eq('id', historyId);

    if (historyError) {
      console.error('Error updating history:', historyError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        artifactsCount,
        storiesCount,
        message: `Successfully completed. Created ${artifactsCount} artifacts${runStages === 'both' ? ` and ${storiesCount} stories` : ''}.`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in run-manual-query:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
