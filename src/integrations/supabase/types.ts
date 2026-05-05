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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          id: string
          institution: string | null
          is_active: boolean
          mask: string | null
          name: string
          plaid_account_id: string | null
          plaid_item_id: string | null
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          mask?: string | null
          name: string
          plaid_account_id?: string | null
          plaid_item_id?: string | null
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          mask?: string | null
          name?: string
          plaid_account_id?: string | null
          plaid_item_id?: string | null
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          parent_category: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          parent_category?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          parent_category?: string | null
        }
        Relationships: []
      }
      category_rules: {
        Row: {
          category_id: string
          created_at: string
          id: string
          match_type: Database["public"]["Enums"]["rule_match_type"]
          pattern: string
          priority: number
          source: Database["public"]["Enums"]["rule_source"]
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          match_type?: Database["public"]["Enums"]["rule_match_type"]
          pattern: string
          priority?: number
          source?: Database["public"]["Enums"]["rule_source"]
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          match_type?: Database["public"]["Enums"]["rule_match_type"]
          pattern?: string
          priority?: number
          source?: Database["public"]["Enums"]["rule_source"]
        }
        Relationships: [
          {
            foreignKeyName: "category_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          file_type: string | null
          filename: string | null
          id: string
          imported_rows: number
          status: string
          total_rows: number
        }
        Insert: {
          created_at?: string
          file_type?: string | null
          filename?: string | null
          id?: string
          imported_rows?: number
          status?: string
          total_rows?: number
        }
        Update: {
          created_at?: string
          file_type?: string | null
          filename?: string | null
          id?: string
          imported_rows?: number
          status?: string
          total_rows?: number
        }
        Relationships: []
      }
      merchant_aliases: {
        Row: {
          created_at: string
          display_name: string
          id: string
          match_type: Database["public"]["Enums"]["alias_match_type"]
          pattern: string
          priority: number
          source: Database["public"]["Enums"]["alias_source"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          match_type?: Database["public"]["Enums"]["alias_match_type"]
          pattern: string
          priority?: number
          source?: Database["public"]["Enums"]["alias_source"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          match_type?: Database["public"]["Enums"]["alias_match_type"]
          pattern?: string
          priority?: number
          source?: Database["public"]["Enums"]["alias_source"]
          updated_at?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          created_at: string
          id: string
          name: string
          note: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      plaid_items: {
        Row: {
          access_token: string | null
          created_at: string
          cursor: string | null
          id: string
          institution_name: string | null
          last_synced_at: string | null
          status: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          cursor?: string | null
          id?: string
          institution_name?: string | null
          last_synced_at?: string | null
          status?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          cursor?: string | null
          id?: string
          institution_name?: string | null
          last_synced_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      tags: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      transaction_edits: {
        Row: {
          changed_at: string
          field_changed: string
          id: string
          new_value: Json | null
          old_value: Json | null
          transaction_id: string
        }
        Insert: {
          changed_at?: string
          field_changed: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          transaction_id: string
        }
        Update: {
          changed_at?: string
          field_changed?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_edits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_tags: {
        Row: {
          tag_id: string
          transaction_id: string
        }
        Insert: {
          tag_id: string
          transaction_id: string
        }
        Update: {
          tag_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_tags_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          category_id: string | null
          created_at: string
          date: string
          excluded: boolean
          id: string
          import_batch_id: string | null
          linked_txn_id: string | null
          name: string
          needs_review: boolean
          note: string | null
          plaid_transaction_id: string | null
          raw_row: Json | null
          recurring: string | null
          review_kind: Database["public"]["Enums"]["review_kind"] | null
          review_reason: string | null
          reviewed: boolean
          reviewed_at: string | null
          source: Database["public"]["Enums"]["txn_source"]
          status: Database["public"]["Enums"]["txn_status"]
          treatment: Database["public"]["Enums"]["txn_treatment"]
          treatment_meta: Json
          type: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category_id?: string | null
          created_at?: string
          date: string
          excluded?: boolean
          id?: string
          import_batch_id?: string | null
          linked_txn_id?: string | null
          name: string
          needs_review?: boolean
          note?: string | null
          plaid_transaction_id?: string | null
          raw_row?: Json | null
          recurring?: string | null
          review_kind?: Database["public"]["Enums"]["review_kind"] | null
          review_reason?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          source?: Database["public"]["Enums"]["txn_source"]
          status?: Database["public"]["Enums"]["txn_status"]
          treatment?: Database["public"]["Enums"]["txn_treatment"]
          treatment_meta?: Json
          type?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category_id?: string | null
          created_at?: string
          date?: string
          excluded?: boolean
          id?: string
          import_batch_id?: string | null
          linked_txn_id?: string | null
          name?: string
          needs_review?: boolean
          note?: string | null
          plaid_transaction_id?: string | null
          raw_row?: Json | null
          recurring?: string | null
          review_kind?: Database["public"]["Enums"]["review_kind"] | null
          review_reason?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          source?: Database["public"]["Enums"]["txn_source"]
          status?: Database["public"]["Enums"]["txn_status"]
          treatment?: Database["public"]["Enums"]["txn_treatment"]
          treatment_meta?: Json
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_linked_txn_id_fkey"
            columns: ["linked_txn_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_type:
        | "credit_card"
        | "debit_card"
        | "checking"
        | "savings"
        | "cash"
        | "other"
      alias_match_type: "contains" | "exact" | "regex"
      alias_source: "user" | "seed"
      review_kind: "duplicate" | "refund_pending" | "reimbursement_pending"
      rule_match_type: "contains" | "equals" | "regex"
      rule_source: "seed" | "user" | "learned"
      txn_source: "manual" | "import" | "plaid"
      txn_status: "pending" | "posted"
      txn_treatment:
        | "normal"
        | "excluded"
        | "refundable"
        | "reimbursable"
        | "amortized"
        | "split"
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
    Enums: {
      account_type: [
        "credit_card",
        "debit_card",
        "checking",
        "savings",
        "cash",
        "other",
      ],
      alias_match_type: ["contains", "exact", "regex"],
      alias_source: ["user", "seed"],
      review_kind: ["duplicate", "refund_pending", "reimbursement_pending"],
      rule_match_type: ["contains", "equals", "regex"],
      rule_source: ["seed", "user", "learned"],
      txn_source: ["manual", "import", "plaid"],
      txn_status: ["pending", "posted"],
      txn_treatment: [
        "normal",
        "excluded",
        "refundable",
        "reimbursable",
        "amortized",
        "split",
      ],
    },
  },
} as const
