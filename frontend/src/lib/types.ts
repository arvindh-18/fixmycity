export type Status = "open" | "in_progress" | "rechecking" | "resolved" | "rejected";
export type Severity = "low" | "medium" | "high";

export interface Category {
  id: string;
  label: string;
}

export interface AppConfig {
  auth_mode: "supabase" | "dev" | "none";
  supabase: { url: string; anonKey: string } | null;
  ai_enabled: boolean;
  /** Present only in the demo build. */
  demo?: DemoConfig | null;
  city: { name: string; lat: number; lng: number };
  categories: Category[];
}

export type Role = "public" | "worker" | "admin";

export interface Me {
  uid: string;
  name: string;
  email: string;
  role: Role;
  is_admin: boolean;
}

export interface StaffMember {
  email: string;
  name: string;
  role: "worker" | "admin";
  source: "app" | "env";
  added_by: string;
  open_jobs: number;
}

export interface Update {
  status: Status;
  label: string;
  note: string;
  by_name: string;
  created_at: string;
}

export interface Issue {
  id: number;
  title: string;
  description: string;
  category: string;
  category_label: string;
  severity: Severity;
  status: Status;
  lat: number;
  lng: number;
  address: string;
  locality: string;
  pincode: string;
  photo_url: string | null;
  reporter_name: string;
  upvotes: number;
  upvoted: boolean;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  updates?: Update[];
  distance_m?: number;
  original_text: string;
  merged_into: number | null;
  assigned_to_email: string;
  assigned_to_name: string;
  assigned_at: string | null;
  fixed_by_name: string;
  is_assigned_to_me: boolean;
  after_photo_url: string | null;
  unread?: number;
}

export interface Area {
  locality: string;
  pincode: string;
  total: number;
  active: number;
}

export interface Stats {
  total: number;
  open: number;
  in_progress: number;
  rechecking?: number;
  resolved: number;
  resolved_pct: number;
  avg_days_to_fix: number | null;
  this_week: number;
  fixed_this_week: number;
  by_category: { category: string; label: string; count: number }[];
  top_areas: { locality: string; pincode: string; count: number }[];
}

export interface AiDraft {
  is_civic_issue: boolean;
  category: string;
  title: string;
  description: string;
  severity: Severity;
}

export interface AiStructured extends AiDraft {
  landmark: string;
  original_language: "en" | "ta" | "hi" | "mixed";
  translated_text: string;
}

export interface DemoPersona {
  token: string;
  name: string;
  role: Role;
  blurb: string;
}

export interface DemoConfig {
  location: { lat: number; lng: number; label: string };
  personas: DemoPersona[];
  offline_ai: boolean;
}
