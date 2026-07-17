export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      business_settings: {
        Row: {
          high_value_threshold_cents: number
          id: number
          reception_terms: string
          updated_at: string
        }
        Insert: {
          high_value_threshold_cents?: number
          id?: number
          reception_terms?: string
          updated_at?: string
        }
        Update: {
          high_value_threshold_cents?: number
          id?: number
          reception_terms?: string
          updated_at?: string
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          amount_cents: number
          cash_session_id: string
          created_at: string
          created_by: string | null
          id: string
          reason: string
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Insert: {
          amount_cents: number
          cash_session_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason: string
          type: Database["public"]["Enums"]["cash_movement_type"]
        }
        Update: {
          amount_cents?: number
          cash_session_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string
          type?: Database["public"]["Enums"]["cash_movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_session_expected"
            referencedColumns: ["cash_session_id"]
          },
          {
            foreignKeyName: "cash_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          counted_cents: number | null
          difference_cents: number | null
          expected_cents: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_cents: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cents?: number | null
          difference_cents?: number | null
          expected_cents?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_cents?: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cents?: number | null
          difference_cents?: number | null
          expected_cents?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_options: {
        Row: {
          active: boolean
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      item_types: {
        Row: {
          active: boolean
          has_diagram: boolean
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          has_diagram?: boolean
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          has_diagram?: boolean
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      order_articles: {
        Row: {
          brand: string | null
          color: string | null
          condition_notes: string | null
          condition_tags: string[]
          created_at: string
          declared_value_cents: number | null
          id: string
          item_type: string
          model: string | null
          order_id: string
          sort_order: number
        }
        Insert: {
          brand?: string | null
          color?: string | null
          condition_notes?: string | null
          condition_tags?: string[]
          created_at?: string
          declared_value_cents?: number | null
          id?: string
          item_type: string
          model?: string | null
          order_id: string
          sort_order?: number
        }
        Update: {
          brand?: string | null
          color?: string | null
          condition_notes?: string | null
          condition_tags?: string[]
          created_at?: string
          declared_value_cents?: number | null
          id?: string
          item_type?: string
          model?: string | null
          order_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_articles_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_balances"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_articles_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_diagram_marks: {
        Row: {
          article_id: string
          created_at: string
          description: string | null
          id: string
          idx: number
          mark_type: string
          order_id: string
          x_rel: number
          y_rel: number
        }
        Insert: {
          article_id: string
          created_at?: string
          description?: string | null
          id?: string
          idx: number
          mark_type: string
          order_id: string
          x_rel: number
          y_rel: number
        }
        Update: {
          article_id?: string
          created_at?: string
          description?: string | null
          id?: string
          idx?: number
          mark_type?: string
          order_id?: string
          x_rel?: number
          y_rel?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_diagram_marks_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "order_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_diagram_marks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_balances"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_diagram_marks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          article_id: string | null
          created_at: string
          id: string
          item_label: string | null
          item_notes: string | null
          line_total_cents: number | null
          order_id: string
          photo_urls: string[]
          quantity: number
          service_id: string | null
          service_name: string
          unit_price_cents: number
        }
        Insert: {
          article_id?: string | null
          created_at?: string
          id?: string
          item_label?: string | null
          item_notes?: string | null
          line_total_cents?: number | null
          order_id: string
          photo_urls?: string[]
          quantity?: number
          service_id?: string | null
          service_name: string
          unit_price_cents: number
        }
        Update: {
          article_id?: string | null
          created_at?: string
          id?: string
          item_label?: string | null
          item_notes?: string | null
          line_total_cents?: number | null
          order_id?: string
          photo_urls?: string[]
          quantity?: number
          service_id?: string | null
          service_name?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "order_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_balances"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      order_photos: {
        Row: {
          article_id: string | null
          classification: string | null
          created_at: string
          id: string
          order_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          article_id?: string | null
          classification?: string | null
          created_at?: string
          id?: string
          order_id: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          article_id?: string | null
          classification?: string | null
          created_at?: string
          id?: string
          order_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_photos_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "order_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_photos_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_balances"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_photos_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: string
          note: string | null
          order_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          note?: string | null
          order_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          note?: string | null
          order_id?: string
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_balances"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string | null
          delivered_at: string | null
          discount_cents: number
          folio: string
          id: string
          notes: string | null
          promised_at: string | null
          received_at: string
          responsiva_accepted: boolean
          responsiva_accepted_at: string | null
          signature_path: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          discount_cents?: number
          folio?: string
          id?: string
          notes?: string | null
          promised_at?: string | null
          received_at?: string
          responsiva_accepted?: boolean
          responsiva_accepted_at?: string | null
          signature_path?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          delivered_at?: string | null
          discount_cents?: number
          folio?: string
          id?: string
          notes?: string | null
          promised_at?: string | null
          received_at?: string
          responsiva_accepted?: boolean
          responsiva_accepted_at?: string | null
          signature_path?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          cash_session_id: string | null
          change_cents: number | null
          created_at: string
          created_by: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          reference: string | null
          tendered_cents: number | null
        }
        Insert: {
          amount_cents: number
          cash_session_id?: string | null
          change_cents?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          order_id: string
          reference?: string | null
          tendered_cents?: number | null
        }
        Update: {
          amount_cents?: number
          cash_session_id?: string | null
          change_cents?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          order_id?: string
          reference?: string | null
          tendered_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_session_expected"
            referencedColumns: ["cash_session_id"]
          },
          {
            foreignKeyName: "payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_balances"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          full_name: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          full_name: string
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          full_name?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      services: {
        Row: {
          active: boolean
          category_id: string | null
          created_at: string
          description: string | null
          estimated_days: number
          id: string
          name: string
          price_cents: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          estimated_days?: number
          id?: string
          name: string
          price_cents: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category_id?: string | null
          created_at?: string
          description?: string | null
          estimated_days?: number
          id?: string
          name?: string
          price_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      supplies: {
        Row: {
          active: boolean
          cost_cents: number | null
          created_at: string
          description: string | null
          id: string
          min_stock: number
          name: string
          stock: number
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          min_stock?: number
          name: string
          stock?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cost_cents?: number | null
          created_at?: string
          description?: string | null
          id?: string
          min_stock?: number
          name?: string
          stock?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      supply_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          order_id: string | null
          quantity: number
          reference: string | null
          stock_after: number
          stock_before: number
          supply_id: string
          type: Database["public"]["Enums"]["supply_movement_type"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          quantity: number
          reference?: string | null
          stock_after?: number
          stock_before?: number
          supply_id: string
          type: Database["public"]["Enums"]["supply_movement_type"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          order_id?: string | null
          quantity?: number
          reference?: string | null
          stock_after?: number
          stock_before?: number
          supply_id?: string
          type?: Database["public"]["Enums"]["supply_movement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "supply_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "order_balances"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "supply_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_movements_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cash_session_expected: {
        Row: {
          cash_session_id: string | null
          expected_cents: number | null
        }
        Insert: {
          cash_session_id?: string | null
          expected_cents?: never
        }
        Update: {
          cash_session_id?: string | null
          expected_cents?: never
        }
        Relationships: []
      }
      order_balances: {
        Row: {
          balance_cents: number | null
          folio: string | null
          order_id: string | null
          paid_cents: number | null
          total_cents: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      close_cash_session: {
        Args: { p_counted: number; p_notes?: string; p_session_id: string }
        Returns: {
          closed_at: string | null
          closed_by: string | null
          counted_cents: number | null
          difference_cents: number | null
          expected_cents: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_cents: number
        }
        SetofOptions: {
          from: "*"
          to: "cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_order: {
        Args: {
          p_customer_id: string
          p_discount?: number
          p_items: Json
          p_notes?: string
          p_order_id?: string
          p_promised_at?: string
        }
        Returns: string
      }
      create_reception: {
        Args: {
          p_articles: Json
          p_customer_id: string
          p_discount?: number
          p_notes?: string
          p_order_id?: string
          p_payment?: Json
          p_promised_at?: string
          p_responsiva?: boolean
          p_signature_path?: string
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
    }
    Enums: {
      cash_movement_type: "entrada" | "salida"
      order_status:
        | "recibido"
        | "en_proceso"
        | "listo"
        | "entregado"
        | "cancelado"
      payment_method: "efectivo" | "tarjeta" | "transferencia"
      supply_movement_type: "compra" | "consumo" | "ajuste" | "merma"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cash_movement_type: ["entrada", "salida"],
      order_status: [
        "recibido",
        "en_proceso",
        "listo",
        "entregado",
        "cancelado",
      ],
      payment_method: ["efectivo", "tarjeta", "transferencia"],
      supply_movement_type: ["compra", "consumo", "ajuste", "merma"],
    },
  },
} as const

