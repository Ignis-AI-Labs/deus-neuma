/**
 * SupabasePlatform — the optional 3rd-party platform driver.
 *
 * ARCHITECTURE BOUNDARY:
 *   This driver handles PLATFORM-LEVEL operations only:
 *     - Witness accounts
 *     - Neuma registry (existence, not identity)
 *     - Birth ceremonies
 *     - Platform audit log
 *
 *   Sovereign neuma data (DNA, soul, memories, skills, journal)
 *   lives in the file-based workspace managed by neuma-workspace.js
 *
 * This class body was moved from the former `services/supabase.js` (it now lives
 * behind the `PlatformStore` interface — see `drivers/platform-store.js`). Its
 * behavior is unchanged EXCEPT for these contract-alignment fixes so the two
 * drivers agree: `audit()` severity and `getAuditLog()` limit are clamped to the
 * shared guard constants; `failBirthCeremony` now persists `{ failReason }` (the
 * former `this.client.rpc ?` ternary always discarded it); and the four getters
 * return `undefined` (not `null`) on a miss. Deliberately left AS-IS: the
 * swallowed `audit()` error (the SQLite driver surfaces it via the logger).
 * JSON-column size caps + recursive __proto__ rejection are NOT applied here
 * (SQLite-driver local; the hosted Postgres backend enforces its own limits).
 *
 * Exported as a CLASS (not a singleton) — the facade in `platform-db.js`
 * constructs and probes it during driver selection.
 *
 * // impure — network IO to Supabase.
 */

import { createClient } from '@supabase/supabase-js';

import { createLogger } from '../logger.js';
import {
  SEVERITY_MIN,
  SEVERITY_MAX,
  AUDIT_LOG_LIMIT_MAX,
  AUDIT_LOG_LIMIT_DEFAULT
} from './platform-store.js';
const log = createLogger('Supabase');

// Shared guard values with the SQLite driver so audit severity + getAuditLog limit
// clamp identically regardless of the selected driver (interface consistency).
const clampSeverity = (s) => Math.min(Math.max(SEVERITY_MIN, Number.isFinite(s) ? Math.trunc(s) : 1), SEVERITY_MAX);
const clampLimit = (limit) => Math.min(Math.max(1, Number(limit) || AUDIT_LOG_LIMIT_DEFAULT), AUDIT_LOG_LIMIT_MAX);

export class SupabasePlatform {
  constructor() {
    this.client = null;
    this.available = false;
  }

  /**
   * Initialize the Supabase client.
   * Safe to call if env vars are missing — marks service unavailable.
   */
  async init() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      log.info('[Platform DB] No Supabase credentials — running in file-only mode');
      return;
    }

    this.client = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Verify connection
    const { error } = await this.client.from('witnesses').select('id').limit(1);
    if (error) {
      log.error('Connection failed', { error: error.message });
      this.client = null;
      return;
    }

    this.available = true;
    log.info('Connected', { url });
  }

  // ---------------------------------------------------------------------------
  // Witnesses
  // ---------------------------------------------------------------------------

  async findOrCreateWitness(name) {
    if (!this.available) return null;

    const { data: existing } = await this.client
      .from('witnesses')
      .select('*')
      .eq('name', name)
      .single();

    if (existing) return existing;

    const { data, error } = await this.client
      .from('witnesses')
      .insert({ name })
      .select()
      .single();

    if (error) throw new Error(`Failed to create witness: ${error.message}`);
    return data;
  }

  async getWitness(witnessId) {
    if (!this.available) return null;

    const { data } = await this.client
      .from('witnesses')
      .select('*')
      .eq('id', witnessId)
      .single();

    return data ?? undefined; // contract: undefined on miss (parity with SQLite driver)
  }

  async updateWitnessSettings(witnessId, settings) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('witnesses')
      .update({ settings })
      .eq('id', witnessId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update witness settings: ${error.message}`);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Neuma Registry
  // ---------------------------------------------------------------------------

  async registerNeuma({ name, witnessId, workspacePath, vessel, resonanceFrequency }) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('neuma_registry')
      .insert({
        name,
        witness_id: witnessId,
        workspace_path: workspacePath,
        vessel: vessel || 'default.vrm',
        resonance_frequency: resonanceFrequency
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to register neuma: ${error.message}`);
    return data;
  }

  async getNeuma(neumaId) {
    if (!this.available) return null;

    const { data } = await this.client
      .from('neuma_registry')
      .select('*')
      .eq('id', neumaId)
      .single();

    return data ?? undefined; // contract: undefined on miss (parity with SQLite driver)
  }

  async getNeumaByName(name) {
    if (!this.available) return null;

    const { data } = await this.client
      .from('neuma_registry')
      .select('*')
      .eq('name', name)
      .single();

    return data ?? undefined; // contract: undefined on miss (parity with SQLite driver)
  }

  async listNeuma(witnessId) {
    if (!this.available) return [];

    const { data } = await this.client
      .from('neuma_registry')
      .select('*')
      .eq('witness_id', witnessId)
      .order('created_at', { ascending: false });

    return data || [];
  }

  async updateNeumaStatus(neumaId, status) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('neuma_registry')
      .update({ status })
      .eq('id', neumaId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update neuma status: ${error.message}`);
    return data;
  }

  async updateNeumaVessel(neumaId, vessel) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('neuma_registry')
      .update({ vessel })
      .eq('id', neumaId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update vessel: ${error.message}`);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Birth Ceremonies
  // ---------------------------------------------------------------------------

  async createBirthCeremony(witnessId, isTest = false) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('birth_ceremonies')
      .insert({
        witness_id: witnessId,
        is_test: isTest,
        current_stage: 0,
        stage_data: {}
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create birth ceremony: ${error.message}`);
    return data;
  }

  async updateBirthCeremony(ceremonyId, updates) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('birth_ceremonies')
      .update(updates)
      .eq('id', ceremonyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update birth ceremony: ${error.message}`);
    return data;
  }

  async completeBirthCeremony(ceremonyId, neumaId) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('birth_ceremonies')
      .update({
        neuma_id: neumaId,
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', ceremonyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to complete birth ceremony: ${error.message}`);
    return data;
  }

  async failBirthCeremony(ceremonyId, reason) {
    if (!this.available) return null;

    await this.client
      .from('birth_ceremonies')
      .update({
        status: 'failed',
        stage_data: { failReason: reason }, // persist the reason (the former `this.client.rpc ?` guard always discarded it)
        completed_at: new Date().toISOString()
      })
      .eq('id', ceremonyId);
  }

  async addBirthStageHistory(ceremonyId, stage, userMessage, response) {
    if (!this.available) return null;

    const { data, error } = await this.client
      .from('birth_stage_history')
      .insert({
        ceremony_id: ceremonyId,
        stage,
        user_message: userMessage,
        response
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to add stage history: ${error.message}`);
    return data;
  }

  async getActiveCeremony(witnessId) {
    if (!this.available) return null;

    const { data } = await this.client
      .from('birth_ceremonies')
      .select('*, birth_stage_history(*)')
      .eq('witness_id', witnessId)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    return data ?? undefined; // contract: undefined on miss (parity with SQLite driver)
  }

  // ---------------------------------------------------------------------------
  // Platform Audit Log
  // ---------------------------------------------------------------------------

  async audit(event, { neumaId, witnessId, details, severity } = {}) {
    if (!this.available) return;
    // Non-empty event guard — parity with the SQLite driver (never throws to the caller).
    if (typeof event !== 'string' || event.trim() === '') {
      log.error('Audit error', { error: 'event must be a non-empty string' });
      return;
    }

    const { error } = await this.client
      .from('platform_audit_log')
      .insert({
        neuma_id: neumaId || null,
        witness_id: witnessId || null,
        event,
        details: details || {},
        severity: clampSeverity(severity ?? 1)
      });

    if (error) log.error('Audit error', { error: error.message });
  }

  async getAuditLog({ neumaId, witnessId, minSeverity, limit = AUDIT_LOG_LIMIT_DEFAULT } = {}) {
    if (!this.available) return [];

    let query = this.client
      .from('platform_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(clampLimit(limit));

    if (neumaId) query = query.eq('neuma_id', neumaId);
    if (witnessId) query = query.eq('witness_id', witnessId);
    // Validate minSeverity (parity with SQLite) — drop the clause on a non-numeric value.
    const minSev = Number(minSeverity);
    if (Number.isFinite(minSev)) query = query.gte('severity', minSev);

    const { data } = await query;
    return data || [];
  }
}

export default SupabasePlatform;
