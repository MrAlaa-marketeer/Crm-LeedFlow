export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      lead_activities: {
        Row: {
          activity_type:
            | "lead.created"
            | "lead.updated"
            | "lead.status_changed"
            | "lead.archived"
            | "lead.restored"
            | "lead.deleted"
            | "follow_up.created"
            | "follow_up.updated"
            | "follow_up.completed"
            | "follow_up.reopened"
            | "follow_up.deleted";
          actor_id: string | null;
          created_at: string;
          details: Json;
          id: string;
          lead_id: string | null;
          workspace_id: string;
        };
        Insert: {
          activity_type: Database["public"]["Tables"]["lead_activities"]["Row"]["activity_type"];
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          lead_id?: string | null;
          workspace_id: string;
        };
        Update: {
          activity_type?: Database["public"]["Tables"]["lead_activities"]["Row"]["activity_type"];
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          lead_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lead_activities_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_activities_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      follow_ups: {
        Row: {
          assigned_to: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          due_at: string;
          id: string;
          is_demo: boolean;
          lead_id: string;
          notes: string | null;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at: string;
          id?: string;
          is_demo?: boolean;
          lead_id: string;
          notes?: string | null;
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_at?: string;
          id?: string;
          is_demo?: boolean;
          lead_id?: string;
          notes?: string | null;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follow_ups_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_ups_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_ups_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          archived_at: string | null;
          assigned_to: string | null;
          budget_max: number | null;
          budget_min: number | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          full_name: string;
          id: string;
          interested_project: string | null;
          is_demo: boolean;
          next_follow_up_at: string | null;
          notes: string | null;
          phone: string;
          preferred_area: string | null;
          source: Database["public"]["Enums"]["lead_source"];
          status: Database["public"]["Enums"]["lead_status"];
          status_changed_at: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          archived_at?: string | null;
          assigned_to?: string | null;
          budget_max?: number | null;
          budget_min?: number | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          full_name: string;
          id?: string;
          interested_project?: string | null;
          is_demo?: boolean;
          next_follow_up_at?: string | null;
          notes?: string | null;
          phone: string;
          preferred_area?: string | null;
          source?: Database["public"]["Enums"]["lead_source"];
          status?: Database["public"]["Enums"]["lead_status"];
          status_changed_at?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          archived_at?: string | null;
          assigned_to?: string | null;
          budget_max?: number | null;
          budget_min?: number | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          full_name?: string;
          id?: string;
          interested_project?: string | null;
          is_demo?: boolean;
          next_follow_up_at?: string | null;
          notes?: string | null;
          phone?: string;
          preferred_area?: string | null;
          source?: Database["public"]["Enums"]["lead_source"];
          status?: Database["public"]["Enums"]["lead_status"];
          status_changed_at?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          language: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          full_name?: string | null;
          id: string;
          language?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          language?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["workspace_role"];
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      dashboard_stats: {
        Args: {
          _from: string;
          _month_start: string;
          _to: string;
          _today_end: string;
          _today_start: string;
          _workspace_id: string;
        };
        Returns: Json;
      };
      has_workspace_role: {
        Args: {
          _role: Database["public"]["Enums"]["workspace_role"];
          _workspace_id: string;
        };
        Returns: boolean;
      };
      is_user_in_workspace: {
        Args: { _user_id: string; _workspace_id: string };
        Returns: boolean;
      };
      is_workspace_member: { Args: { _workspace_id: string }; Returns: boolean };
      load_demo_data: { Args: { _workspace_id: string }; Returns: number };
      remove_demo_data: { Args: { _workspace_id: string }; Returns: number };
      shares_workspace_with: { Args: { _other_user: string }; Returns: boolean };
      sync_lead_next_follow_up: {
        Args: { _lead_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      lead_source: "facebook" | "instagram" | "whatsapp" | "referral" | "website" | "other";
      lead_status: "new" | "contacted" | "qualified" | "meeting" | "negotiation" | "won" | "lost";
      workspace_role: "owner" | "agent";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      lead_source: ["facebook", "instagram", "whatsapp", "referral", "website", "other"],
      lead_status: ["new", "contacted", "qualified", "meeting", "negotiation", "won", "lost"],
      workspace_role: ["owner", "agent"],
    },
  },
} as const;
