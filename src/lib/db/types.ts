/**
 * Row shapes for the RailDrop schema. Hand-written (rather than generated) so the
 * repo has no dependency on a running database to typecheck.
 */

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface StationRow {
  code: string;
  name: string;
  city: string;
  state: string;
  timezone: string | null;
  is_active: boolean;
  updated_at: string;
}

export interface WatchRow {
  id: string;
  user_id: string;
  origin_code: string;
  destination_code: string;
  desired_date: string;
  passengers: number;
  benchmark_cents: number;
  benchmark_version: number;
  original_train_number: string | null;
  original_departure_local: string | null;
  original_fare_family: string;
  booked_at: string;
  date_flexibility_days: number;
  travel_class: string;
  benchmark_fare_family: string;
  include_thruway: boolean;
  include_restricted_fares: boolean;
  minimum_savings_cents: number;
  target_price_cents: number | null;
  linked_watch_id: string | null;
  preferred_departure_minutes: number | null;
  timezone: string;
  status: string;
  status_reason: string | null;
  monitoring_starts_at: string;
  monitoring_ends_at: string;
  last_alerted_at: string | null;
  last_alert_best_total_cents: number | null;
  last_alert_signature: string | null;
  last_alert_convenience_score: number | null;
  last_checked_at: string | null;
  last_cycle_status: string | null;
  best_total_cents: number | null;
  best_option_id: string | null;
  deleted_at: string | null;
  note: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScheduledCheckRunRow {
  id: string;
  watch_id: string;
  user_id: string;
  local_date: string;
  check_slot: string;
  status: string;
  skip_reason: string | null;
  attempt: number;
  leased_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CycleRow {
  id: string;
  watch_id: string;
  user_id: string;
  scheduled_check_run_id: string | null;
  dispatch_run_id: string | null;
  trigger: string;
  status: string;
  benchmark_cents: number;
  benchmark_version: number;
  dates_total: number;
  dates_succeeded: number;
  dates_failed: number;
  journeys_returned: number;
  eligible_candidates: number;
  qualifying_options: number;
  best_total_cents: number | null;
  best_savings_cents: number | null;
  alert_suppressed_reason: string | null;
  error_kind: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface SnapshotRow {
  id: string;
  cycle_id: string;
  watch_id: string;
  user_id: string;
  provider_request_id: string | null;
  travel_date: string;
  displacement_days: number;
  status: 'SUCCESS' | 'NO_AVAILABILITY' | 'FAILED';
  error_kind: string | null;
  error_message: string | null;
  journeys_returned: number;
  eligible_candidates: number;
  rejected_summary: Record<string, number>;
  cheapest_total_cents: number | null;
  created_at: string;
}

export interface JourneyOptionRow {
  id: string;
  snapshot_id: string;
  watch_id: string;
  user_id: string;
  provider_journey_id: string;
  service_name: string | null;
  train_number: string | null;
  origin_code: string;
  destination_code: string;
  departure_local: string;
  arrival_local: string;
  duration_minutes: number;
  transfers: number;
  travel_date: string;
  service_type: string;
  booking_url: string | null;
  legs: unknown;
  created_at: string;
}

export interface FareOptionRow {
  id: string;
  journey_option_id: string;
  snapshot_id: string;
  watch_id: string;
  user_id: string;
  fare_family: string;
  fare_family_raw: string | null;
  travel_class: string;
  amount_cents: number;
  party_total_cents: number;
  currency: string;
  pricing_basis: string;
  pricing_confidence: string;
  availability: string;
  restricted: boolean;
  refundable: boolean | null;
  seats_remaining: number | null;
  is_qualifying: boolean;
  savings_cents: number | null;
  displacement_days: number;
  convenience_score: number | null;
  rank: number | null;
  signature: string;
  created_at: string;
}

export interface AlertRow {
  id: string;
  watch_id: string;
  user_id: string;
  cycle_id: string | null;
  reason: string;
  dedupe_key: string;
  benchmark_cents: number;
  best_total_cents: number;
  savings_cents: number;
  best_signature: string;
  best_convenience_score: number | null;
  options_snapshot: unknown;
  cycle_status: string;
  unchecked_dates: string[];
  created_at: string;
}

export interface DeliveryRow {
  id: string;
  alert_id: string;
  watch_id: string;
  user_id: string;
  channel: string;
  recipient: string;
  subject: string;
  status: string;
  attempt: number;
  provider_message_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
}

export interface BookingPriceEventRow {
  id: string;
  watch_id: string;
  user_id: string;
  event_type: string;
  amount_cents: number;
  benchmark_version: number;
  travel_date: string | null;
  train_number: string | null;
  departure_local: string | null;
  fare_family: string | null;
  note: string | null;
  created_at: string;
}
