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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          currency: string
          id: boolean
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          currency?: string
          id?: boolean
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          currency?: string
          id?: boolean
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_events: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: number
          idempotency_key: string | null
          outlet_id: string | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: never
          idempotency_key?: string | null
          outlet_id?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: never
          idempotency_key?: string | null
          outlet_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_events_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      calibration_history: {
        Row: {
          calibration_id: string
          changed_at: string
          changed_by: string | null
          id: number
          previous: Json
        }
        Insert: {
          calibration_id: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          previous: Json
        }
        Update: {
          calibration_id?: string
          changed_at?: string
          changed_by?: string | null
          id?: never
          previous?: Json
        }
        Relationships: [
          {
            foreignKeyName: "calibration_history_calibration_id_fkey"
            columns: ["calibration_id"]
            isOneToOne: false
            referencedRelation: "calibrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibration_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calibrations: {
        Row: {
          business_date: string
          coffee_bean_material_id: string
          created_at: string
          created_by: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          dose_g: number
          extraction_time_seconds: number
          grind_setting: string
          id: string
          outlet_id: string
          revision: number
          taste_notes: string | null
          updated_at: string
          updated_by: string | null
          yield_g: number
        }
        Insert: {
          business_date?: string
          coffee_bean_material_id: string
          created_at?: string
          created_by?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          dose_g: number
          extraction_time_seconds: number
          grind_setting: string
          id?: string
          outlet_id: string
          revision?: number
          taste_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          yield_g: number
        }
        Update: {
          business_date?: string
          coffee_bean_material_id?: string
          created_at?: string
          created_by?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          dose_g?: number
          extraction_time_seconds?: number
          grind_setting?: string
          id?: string
          outlet_id?: string
          revision?: number
          taste_notes?: string | null
          updated_at?: string
          updated_by?: string | null
          yield_g?: number
        }
        Relationships: [
          {
            foreignKeyName: "calibrations_coffee_bean_material_id_fkey"
            columns: ["coffee_bean_material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibrations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibrations_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibrations_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calibrations_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_snapshot_lines: {
        Row: {
          conversion_id: string | null
          display_name: string
          id: string
          incomplete_reason: string | null
          line_cost: number | null
          line_type: string
          material_id: string | null
          pack_id: string | null
          packaging_item_id: string | null
          packaging_price_id: string | null
          parent_line_id: string | null
          prep_recipe_version_id: string | null
          price_version_id: string | null
          quantity: number
          snapshot_id: string
          unit: string
          unit_cost: number | null
        }
        Insert: {
          conversion_id?: string | null
          display_name: string
          id?: string
          incomplete_reason?: string | null
          line_cost?: number | null
          line_type: string
          material_id?: string | null
          pack_id?: string | null
          packaging_item_id?: string | null
          packaging_price_id?: string | null
          parent_line_id?: string | null
          prep_recipe_version_id?: string | null
          price_version_id?: string | null
          quantity: number
          snapshot_id: string
          unit: string
          unit_cost?: number | null
        }
        Update: {
          conversion_id?: string | null
          display_name?: string
          id?: string
          incomplete_reason?: string | null
          line_cost?: number | null
          line_type?: string
          material_id?: string | null
          pack_id?: string | null
          packaging_item_id?: string | null
          packaging_price_id?: string | null
          parent_line_id?: string | null
          prep_recipe_version_id?: string | null
          price_version_id?: string | null
          quantity?: number
          snapshot_id?: string
          unit?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_snapshot_lines_conversion_id_fkey"
            columns: ["conversion_id"]
            isOneToOne: false
            referencedRelation: "material_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "material_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_packaging_item_id_fkey"
            columns: ["packaging_item_id"]
            isOneToOne: false
            referencedRelation: "packaging_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_packaging_price_id_fkey"
            columns: ["packaging_price_id"]
            isOneToOne: false
            referencedRelation: "packaging_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_parent_line_id_fkey"
            columns: ["parent_line_id"]
            isOneToOne: false
            referencedRelation: "cost_snapshot_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_prep_recipe_version_id_fkey"
            columns: ["prep_recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_price_version_id_fkey"
            columns: ["price_version_id"]
            isOneToOne: false
            referencedRelation: "material_price_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshot_lines_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "cost_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_snapshots: {
        Row: {
          calculated_at: string
          calculated_by: string | null
          currency: string
          id: string
          incomplete_reasons: Json
          is_complete: boolean
          menu_id: string | null
          outlet_id: string
          reason: string
          recipe_version_id: string
          selling_price: number | null
          total_cost: number | null
        }
        Insert: {
          calculated_at?: string
          calculated_by?: string | null
          currency?: string
          id?: string
          incomplete_reasons?: Json
          is_complete: boolean
          menu_id?: string | null
          outlet_id: string
          reason: string
          recipe_version_id: string
          selling_price?: number | null
          total_cost?: number | null
        }
        Update: {
          calculated_at?: string
          calculated_by?: string | null
          currency?: string
          id?: string
          incomplete_reasons?: Json
          is_complete?: boolean
          menu_id?: string | null
          outlet_id?: string
          reason?: string
          recipe_version_id?: string
          selling_price?: number | null
          total_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_snapshots_calculated_by_fkey"
            columns: ["calculated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshots_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshots_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_snapshots_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_access_log: {
        Row: {
          accessed_at: string
          accessed_by: string
          id: number
          user_id: string
        }
        Insert: {
          accessed_at?: string
          accessed_by: string
          id?: never
          user_id: string
        }
        Update: {
          accessed_at?: string
          accessed_by?: string
          id?: never
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_access_log_accessed_by_fkey"
            columns: ["accessed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_access_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitation_outlets: {
        Row: {
          invitation_id: string
          outlet_id: string
        }
        Insert: {
          invitation_id: string
          outlet_id: string
        }
        Update: {
          invitation_id?: string
          outlet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitation_outlets_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitation_outlets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          email_normalized: string | null
          expires_at: string
          id: string
          invited_by: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          email_normalized?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          email_normalized?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_accepted_user_id_fkey"
            columns: ["accepted_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      material_conversions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          conditions: string | null
          created_at: string
          created_by: string
          grams_per_ml: number
          id: string
          material_id: string
          revision: number
          source: string
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          conditions?: string | null
          created_at?: string
          created_by?: string
          grams_per_ml: number
          id?: string
          material_id: string
          revision?: number
          source: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          conditions?: string | null
          created_at?: string
          created_by?: string
          grams_per_ml?: number
          id?: string
          material_id?: string
          revision?: number
          source?: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_conversions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_conversions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_conversions_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      material_packs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          material_id: string
          pack_quantity: number
          revision: number
          status: Database["public"]["Enums"]["approval_status"]
          unit: Database["public"]["Enums"]["measure_unit"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          material_id: string
          pack_quantity: number
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          unit: Database["public"]["Enums"]["measure_unit"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          material_id?: string
          pack_quantity?: number
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          unit?: Database["public"]["Enums"]["measure_unit"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_packs_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_packs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_packs_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      material_price_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          currency: string
          effective_from: string | null
          free_reason: string | null
          id: string
          pack_id: string
          price: number
          revision: number
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          effective_from?: string | null
          free_reason?: string | null
          id?: string
          pack_id: string
          price: number
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          effective_from?: string | null
          free_reason?: string | null
          id?: string
          pack_id?: string
          price?: number
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_price_versions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_price_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_price_versions_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "material_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      material_revisions: {
        Row: {
          abv: number | null
          bx: number | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_coffee_bean: boolean
          material_id: string
          material_type_id: string
          photo_asset_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          status: Database["public"]["Enums"]["approval_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          abv?: number | null
          bx?: number | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_coffee_bean?: boolean
          material_id: string
          material_type_id: string
          photo_asset_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          abv?: number | null
          bx?: number | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_coffee_bean?: boolean
          material_id?: string
          material_type_id?: string
          photo_asset_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_revisions_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_revisions_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_revisions_photo_asset_id_fkey"
            columns: ["photo_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_revisions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      material_types: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          revision: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          revision?: number
          sort_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          revision?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      materials: {
        Row: {
          abv: number | null
          approved_at: string | null
          approved_by: string | null
          brand: string | null
          brand_normalized: string | null
          bx: number | null
          cost_pack_id: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          is_coffee_bean: boolean
          material_type_id: string
          name: string
          name_normalized: string | null
          no_brand: boolean
          photo_asset_id: string | null
          revision: number
          specification: string | null
          specification_normalized: string | null
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          abv?: number | null
          approved_at?: string | null
          approved_by?: string | null
          brand?: string | null
          brand_normalized?: string | null
          bx?: number | null
          cost_pack_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_coffee_bean?: boolean
          material_type_id: string
          name: string
          name_normalized?: string | null
          no_brand?: boolean
          photo_asset_id?: string | null
          revision?: number
          specification?: string | null
          specification_normalized?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          abv?: number | null
          approved_at?: string | null
          approved_by?: string | null
          brand?: string | null
          brand_normalized?: string | null
          bx?: number | null
          cost_pack_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          is_coffee_bean?: boolean
          material_type_id?: string
          name?: string
          name_normalized?: string | null
          no_brand?: boolean
          photo_asset_id?: string | null
          revision?: number
          specification?: string | null
          specification_normalized?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_cost_pack_fk"
            columns: ["cost_pack_id", "id"]
            isOneToOne: false
            referencedRelation: "material_packs"
            referencedColumns: ["id", "material_id"]
          },
          {
            foreignKeyName: "materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_material_type_id_fkey"
            columns: ["material_type_id"]
            isOneToOne: false
            referencedRelation: "material_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_photo_asset_id_fkey"
            columns: ["photo_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          bucket: string
          created_at: string
          created_by: string
          height: number | null
          id: string
          mime_type: string
          object_path: string
          owner_outlet_id: string | null
          revision: number
          size_bytes: number
          updated_at: string
          upload_status: string
          width: number | null
        }
        Insert: {
          bucket?: string
          created_at?: string
          created_by?: string
          height?: number | null
          id?: string
          mime_type: string
          object_path: string
          owner_outlet_id?: string | null
          revision?: number
          size_bytes: number
          updated_at?: string
          upload_status?: string
          width?: number | null
        }
        Update: {
          bucket?: string
          created_at?: string
          created_by?: string
          height?: number | null
          id?: string
          mime_type?: string
          object_path?: string
          owner_outlet_id?: string | null
          revision?: number
          size_bytes?: number
          updated_at?: string
          upload_status?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_owner_outlet_id_fkey"
            columns: ["owner_outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          id: string
          menu_id: string
          price: number
          recipe_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          menu_id: string
          price: number
          recipe_id: string
          sort_order: number
        }
        Update: {
          id?: string
          menu_id?: string
          price?: number
          recipe_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_publish_history: {
        Row: {
          actor_id: string
          created_at: string
          event: string
          id: number
          menu_id: string
          outlet_id: string
          reason: string | null
          snapshot: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          event: string
          id?: never
          menu_id: string
          outlet_id: string
          reason?: string | null
          snapshot: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          event?: string
          id?: never
          menu_id?: string
          outlet_id?: string
          reason?: string | null
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "menu_publish_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_publish_history_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_publish_history_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_revision_items: {
        Row: {
          id: string
          menu_revision_id: string
          price: number | null
          recipe_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          menu_revision_id: string
          price?: number | null
          recipe_id: string
          sort_order: number
        }
        Update: {
          id?: string
          menu_revision_id?: string
          price?: number | null
          recipe_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_revision_items_menu_revision_id_fkey"
            columns: ["menu_revision_id"]
            isOneToOne: false
            referencedRelation: "menu_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_revision_items_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_revisions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          menu_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          menu_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          menu_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_revisions_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: true
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          outlet_id: string
          published_at: string | null
          published_by: string | null
          revision: number
          status: Database["public"]["Enums"]["menu_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          name: string
          outlet_id: string
          published_at?: string | null
          published_by?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          outlet_id?: string
          published_at?: string | null
          published_by?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menus_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menus_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menus_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outlets: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          revision: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          revision?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          revision?: number
          updated_at?: string
        }
        Relationships: []
      }
      packaging_items: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand: string | null
          brand_normalized: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          name_normalized: string | null
          revision: number
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand?: string | null
          brand_normalized?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name: string
          name_normalized?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand?: string | null
          brand_normalized?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          name_normalized?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_items_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_prices: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          currency: string
          effective_from: string | null
          free_reason: string | null
          id: string
          packaging_item_id: string
          price_per_piece: number
          revision: number
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          effective_from?: string | null
          free_reason?: string | null
          id?: string
          packaging_item_id: string
          price_per_piece: number
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          currency?: string
          effective_from?: string | null
          free_reason?: string | null
          id?: string
          packaging_item_id?: string
          price_per_piece?: number
          revision?: number
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packaging_prices_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_prices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_prices_packaging_item_id_fkey"
            columns: ["packaging_item_id"]
            isOneToOne: false
            referencedRelation: "packaging_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activated_at: string | null
          created_at: string
          deactivated_at: string | null
          email: string
          email_normalized: string | null
          full_name: string
          id: string
          locale: Database["public"]["Enums"]["app_locale"]
          revision: number
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          deactivated_at?: string | null
          email: string
          email_normalized?: string | null
          full_name: string
          id: string
          locale?: Database["public"]["Enums"]["app_locale"]
          revision?: number
          role: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          deactivated_at?: string | null
          email?: string
          email_normalized?: string | null
          full_name?: string
          id?: string
          locale?: Database["public"]["Enums"]["app_locale"]
          revision?: number
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      recipe_copy_provenance: {
        Row: {
          copied_at: string
          copied_by: string
          id: string
          idempotency_key: string | null
          source_outlet_id: string
          source_recipe_id: string
          source_version_id: string
          target_recipe_id: string
          target_version_id: string
        }
        Insert: {
          copied_at?: string
          copied_by: string
          id?: string
          idempotency_key?: string | null
          source_outlet_id: string
          source_recipe_id: string
          source_version_id: string
          target_recipe_id: string
          target_version_id: string
        }
        Update: {
          copied_at?: string
          copied_by?: string
          id?: string
          idempotency_key?: string | null
          source_outlet_id?: string
          source_recipe_id?: string
          source_version_id?: string
          target_recipe_id?: string
          target_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_copy_provenance_copied_by_fkey"
            columns: ["copied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_copy_provenance_source_outlet_id_fkey"
            columns: ["source_outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_copy_provenance_source_recipe_id_fkey"
            columns: ["source_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_copy_provenance_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_copy_provenance_target_recipe_id_fkey"
            columns: ["target_recipe_id"]
            isOneToOne: true
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_copy_provenance_target_version_id_fkey"
            columns: ["target_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          id: string
          material_id: string | null
          notes: string | null
          prep_recipe_id: string | null
          quantity: number | null
          recipe_version_id: string
          sort_order: number
          unit: Database["public"]["Enums"]["measure_unit"] | null
        }
        Insert: {
          id?: string
          material_id?: string | null
          notes?: string | null
          prep_recipe_id?: string | null
          quantity?: number | null
          recipe_version_id: string
          sort_order: number
          unit?: Database["public"]["Enums"]["measure_unit"] | null
        }
        Update: {
          id?: string
          material_id?: string | null
          notes?: string | null
          prep_recipe_id?: string | null
          quantity?: number | null
          recipe_version_id?: string
          sort_order?: number
          unit?: Database["public"]["Enums"]["measure_unit"] | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_prep_recipe_id_fkey"
            columns: ["prep_recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_media: {
        Row: {
          id: string
          media_asset_id: string
          recipe_version_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          media_asset_id: string
          recipe_version_id: string
          sort_order: number
        }
        Update: {
          id?: string
          media_asset_id?: string
          recipe_version_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_media_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_media_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_packaging: {
        Row: {
          id: string
          packaging_item_id: string
          pieces: number
          recipe_version_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          packaging_item_id: string
          pieces: number
          recipe_version_id: string
          sort_order: number
        }
        Update: {
          id?: string
          packaging_item_id?: string
          pieces?: number
          recipe_version_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_packaging_packaging_item_id_fkey"
            columns: ["packaging_item_id"]
            isOneToOne: false
            referencedRelation: "packaging_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_packaging_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_steps: {
        Row: {
          id: string
          instruction: string
          media_asset_id: string | null
          recipe_version_id: string
          step_no: number
        }
        Insert: {
          id?: string
          instruction?: string
          media_asset_id?: string | null
          recipe_version_id: string
          step_no: number
        }
        Update: {
          id?: string
          instruction?: string
          media_asset_id?: string | null
          recipe_version_id?: string
          step_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_steps_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_steps_recipe_version_id_fkey"
            columns: ["recipe_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_versions: {
        Row: {
          appearance_notes: string | null
          approved_at: string | null
          approved_by: string | null
          based_on_version_id: string | null
          change_summary: string | null
          created_at: string
          created_by: string
          cup_type: string | null
          garnish: string | null
          id: string
          product_name: string | null
          purpose: Database["public"]["Enums"]["recipe_purpose"]
          recipe_id: string
          revision: number
          serving_size: string | null
          shelf_life: string | null
          status: Database["public"]["Enums"]["approval_status"]
          storage_method: string | null
          style: Database["public"]["Enums"]["beverage_style"] | null
          submitted_at: string | null
          submitted_by: string | null
          taste_bitter: number | null
          taste_earthy: number | null
          taste_funky: number | null
          taste_oily: number | null
          taste_salty: number | null
          taste_smoky: number | null
          taste_sour: number | null
          taste_spicy: number | null
          taste_sweet: number | null
          taste_umami: number | null
          taste_zesty: number | null
          tasting_notes: string | null
          temperature: Database["public"]["Enums"]["beverage_temp"] | null
          updated_at: string
          updated_by: string | null
          version_no: number
          yield_quantity: number | null
          yield_unit: Database["public"]["Enums"]["measure_unit"] | null
        }
        Insert: {
          appearance_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          based_on_version_id?: string | null
          change_summary?: string | null
          created_at?: string
          created_by?: string
          cup_type?: string | null
          garnish?: string | null
          id?: string
          product_name?: string | null
          purpose?: Database["public"]["Enums"]["recipe_purpose"]
          recipe_id: string
          revision?: number
          serving_size?: string | null
          shelf_life?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          storage_method?: string | null
          style?: Database["public"]["Enums"]["beverage_style"] | null
          submitted_at?: string | null
          submitted_by?: string | null
          taste_bitter?: number | null
          taste_earthy?: number | null
          taste_funky?: number | null
          taste_oily?: number | null
          taste_salty?: number | null
          taste_smoky?: number | null
          taste_sour?: number | null
          taste_spicy?: number | null
          taste_sweet?: number | null
          taste_umami?: number | null
          taste_zesty?: number | null
          tasting_notes?: string | null
          temperature?: Database["public"]["Enums"]["beverage_temp"] | null
          updated_at?: string
          updated_by?: string | null
          version_no: number
          yield_quantity?: number | null
          yield_unit?: Database["public"]["Enums"]["measure_unit"] | null
        }
        Update: {
          appearance_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          based_on_version_id?: string | null
          change_summary?: string | null
          created_at?: string
          created_by?: string
          cup_type?: string | null
          garnish?: string | null
          id?: string
          product_name?: string | null
          purpose?: Database["public"]["Enums"]["recipe_purpose"]
          recipe_id?: string
          revision?: number
          serving_size?: string | null
          shelf_life?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          storage_method?: string | null
          style?: Database["public"]["Enums"]["beverage_style"] | null
          submitted_at?: string | null
          submitted_by?: string | null
          taste_bitter?: number | null
          taste_earthy?: number | null
          taste_funky?: number | null
          taste_oily?: number | null
          taste_salty?: number | null
          taste_smoky?: number | null
          taste_sour?: number | null
          taste_spicy?: number | null
          taste_sweet?: number | null
          taste_umami?: number | null
          taste_zesty?: number | null
          tasting_notes?: string | null
          temperature?: Database["public"]["Enums"]["beverage_temp"] | null
          updated_at?: string
          updated_by?: string | null
          version_no?: number
          yield_quantity?: number | null
          yield_unit?: Database["public"]["Enums"]["measure_unit"] | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_versions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_versions_based_on_version_id_fkey"
            columns: ["based_on_version_id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_versions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_versions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_versions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string
          created_by: string
          current_approved_version_id: string | null
          id: string
          is_prep: boolean
          outlet_id: string
          revision: number
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          current_approved_version_id?: string | null
          id?: string
          is_prep?: boolean
          outlet_id: string
          revision?: number
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          current_approved_version_id?: string | null
          id?: string
          is_prep?: boolean
          outlet_id?: string
          revision?: number
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_current_version_fk"
            columns: ["current_approved_version_id", "id"]
            isOneToOne: false
            referencedRelation: "recipe_versions"
            referencedColumns: ["id", "recipe_id"]
          },
          {
            foreignKeyName: "recipes_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
        ]
      }
      user_identity: {
        Row: {
          created_at: string
          document_last4: string
          document_number_encrypted: string
          document_type: Database["public"]["Enums"]["id_document_type"]
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_last4: string
          document_number_encrypted: string
          document_type: Database["public"]["Enums"]["id_document_type"]
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_last4?: string
          document_number_encrypted?: string
          document_type?: Database["public"]["Enums"]["id_document_type"]
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_identity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_outlets: {
        Row: {
          created_at: string
          outlet_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          outlet_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          outlet_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_outlets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_outlets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_recipe_version: {
        Args: { p_idempotency_key: string; p_version_id: string }
        Returns: Json
      }
      copy_recipe: {
        Args: {
          p_idempotency_key: string
          p_prep_mapping: Json
          p_product_name: string
          p_source_recipe_id: string
          p_target_outlet_id: string
        }
        Returns: Json
      }
      create_invitation: {
        Args: {
          p_email: string
          p_outlet_ids: string[]
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: {
          expires_at: string
          invitation_id: string
          token: string
        }[]
      }
      create_recipe: {
        Args: {
          p_is_prep: boolean
          p_outlet_id: string
          p_product_name: string
        }
        Returns: string
      }
      create_recipe_version: { Args: { p_recipe_id: string }; Returns: string }
      get_invitation: {
        Args: { p_token: string }
        Returns: {
          email: string
          expires_at: string
          outlet_names: string[]
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["invitation_status"]
        }[]
      }
      my_business_date: { Args: never; Returns: string }
      return_recipe_version: {
        Args: { p_reason: string; p_version_id: string }
        Returns: undefined
      }
      reveal_identity_number: { Args: { p_user_id: string }; Returns: string }
      save_recipe_draft: {
        Args: { p_draft: Json; p_revision: number; p_version_id: string }
        Returns: number
      }
      revoke_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      set_my_locale: {
        Args: { p_locale: Database["public"]["Enums"]["app_locale"] }
        Returns: undefined
      }
      submit_recipe_version: {
        Args: { p_revision: number; p_version_id: string }
        Returns: Json
      }
      withdraw_recipe_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_locale: "en" | "zh-CN"
      approval_status:
        | "DRAFT"
        | "PENDING"
        | "APPROVED"
        | "RETURNED"
        | "SUPERSEDED"
        | "ARCHIVED"
      beverage_style:
        | "COFFEE"
        | "TEA"
        | "COCKTAIL"
        | "MOCKTAIL"
        | "PREP_MATERIAL"
      beverage_temp: "HOT" | "COLD" | "FROZEN"
      id_document_type: "NRIC" | "PASSPORT"
      invitation_status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED"
      measure_unit: "g" | "ml"
      menu_status: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED"
      recipe_purpose: "RND" | "OFFICIAL_RELEASE"
      record_status: "ACTIVE" | "ARCHIVED"
      user_role: "ADMIN" | "MANAGER" | "BARISTA"
      user_status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_locale: ["en", "zh-CN"],
      approval_status: [
        "DRAFT",
        "PENDING",
        "APPROVED",
        "RETURNED",
        "SUPERSEDED",
        "ARCHIVED",
      ],
      beverage_style: [
        "COFFEE",
        "TEA",
        "COCKTAIL",
        "MOCKTAIL",
        "PREP_MATERIAL",
      ],
      beverage_temp: ["HOT", "COLD", "FROZEN"],
      id_document_type: ["NRIC", "PASSPORT"],
      invitation_status: ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"],
      measure_unit: ["g", "ml"],
      menu_status: ["DRAFT", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"],
      recipe_purpose: ["RND", "OFFICIAL_RELEASE"],
      record_status: ["ACTIVE", "ARCHIVED"],
      user_role: ["ADMIN", "MANAGER", "BARISTA"],
      user_status: ["INVITED", "ACTIVE", "SUSPENDED", "DEACTIVATED"],
    },
  },
} as const
