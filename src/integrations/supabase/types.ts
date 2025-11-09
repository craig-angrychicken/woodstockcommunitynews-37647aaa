export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      artifacts: {
        Row: {
          content: string | null
          created_at: string
          date: string | null
          guid: string | null
          id: string
          images: Json | null
          is_test: boolean
          name: string
          size_mb: number
          source_id: string | null
          title: string | null
          type: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          date?: string | null
          guid?: string | null
          id?: string
          images?: Json | null
          is_test?: boolean
          name: string
          size_mb?: number
          source_id?: string | null
          title?: string | null
          type: string
        }
        Update: {
          content?: string | null
          created_at?: string
          date?: string | null
          guid?: string | null
          id?: string
          images?: Json | null
          is_test?: boolean
          name?: string
          size_mb?: number
          source_id?: string | null
          title?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          author: string | null
          based_on_version_id: string | null
          content: string
          created_at: string
          id: string
          is_active: boolean | null
          is_test_draft: boolean
          prompt_type: string
          test_results: Json | null
          test_status: string | null
          update_notes: string | null
          updated_at: string
          version_name: string
        }
        Insert: {
          author?: string | null
          based_on_version_id?: string | null
          content: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_test_draft?: boolean
          prompt_type?: string
          test_results?: Json | null
          test_status?: string | null
          update_notes?: string | null
          updated_at?: string
          version_name: string
        }
        Update: {
          author?: string | null
          based_on_version_id?: string | null
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_test_draft?: boolean
          prompt_type?: string
          test_results?: Json | null
          test_status?: string | null
          update_notes?: string | null
          updated_at?: string
          version_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_based_on_version_id_fkey"
            columns: ["based_on_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      query_history: {
        Row: {
          artifacts_count: number | null
          completed_at: string | null
          created_at: string
          date_from: string
          date_to: string
          environment: string
          error_message: string | null
          id: string
          prompt_version_id: string | null
          run_stages: string
          source_ids: string[]
          status: string
          stories_count: number | null
        }
        Insert: {
          artifacts_count?: number | null
          completed_at?: string | null
          created_at?: string
          date_from: string
          date_to: string
          environment: string
          error_message?: string | null
          id?: string
          prompt_version_id?: string | null
          run_stages: string
          source_ids: string[]
          status?: string
          stories_count?: number | null
        }
        Update: {
          artifacts_count?: number | null
          completed_at?: string | null
          created_at?: string
          date_from?: string
          date_to?: string
          environment?: string
          error_message?: string | null
          id?: string
          prompt_version_id?: string | null
          run_stages?: string
          source_ids?: string[]
          status?: string
          stories_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "query_history_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          created_at: string
          id: string
          items_fetched: number | null
          last_fetch_at: string | null
          name: string
          parser_config: Json | null
          status: string
          type: string
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          items_fetched?: number | null
          last_fetch_at?: string | null
          name: string
          parser_config?: Json | null
          status?: string
          type: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          items_fetched?: number | null
          last_fetch_at?: string | null
          name?: string
          parser_config?: Json | null
          status?: string
          type?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      stories: {
        Row: {
          article_type: string | null
          content: string | null
          created_at: string
          environment: string | null
          guid: string | null
          id: string
          is_test: boolean | null
          prompt_version_id: string | null
          published_at: string | null
          source_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          article_type?: string | null
          content?: string | null
          created_at?: string
          environment?: string | null
          guid?: string | null
          id?: string
          is_test?: boolean | null
          prompt_version_id?: string | null
          published_at?: string | null
          source_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          article_type?: string | null
          content?: string | null
          created_at?: string
          environment?: string | null
          guid?: string | null
          id?: string
          is_test?: boolean | null
          prompt_version_id?: string | null
          published_at?: string | null
          source_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stories_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      story_artifacts: {
        Row: {
          artifact_id: string
          created_at: string
          id: string
          story_id: string
        }
        Insert: {
          artifact_id: string
          created_at?: string
          id?: string
          story_id: string
        }
        Update: {
          artifact_id?: string
          created_at?: string
          id?: string
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_artifacts_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_artifacts_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_artifact_story_count: {
        Args: { artifact_guid: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
