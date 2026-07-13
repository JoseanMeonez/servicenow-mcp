import type { Config } from './config.js';
import { SnApiError } from './errors.js';
import type { SnClient } from './client/snClient.js';

export interface UpdateSetInfo {
  sysId: string;
  name: string;
  state?: string;
}

/**
 * Resolves the authenticated user's current update set from
 * sys_user_preference (name = "sys_update_set"). No preference row means
 * ServiceNow's own default applies, i.e. the "Default" update set — which
 * is the safe direction: it blocks writes.
 */
export async function getCurrentUpdateSet(client: SnClient, cfg: Config): Promise<UpdateSetInfo> {
  const users = await client.queryTable<{ sys_id: string }>('sys_user', {
    query: `user_name=${cfg.username}`,
    fields: ['sys_id'],
    limit: 1,
  });
  if (users.records.length === 0) {
    throw new SnApiError({
      status: 404,
      message: `User "${cfg.username}" not found on the instance; cannot resolve current update set`,
    });
  }
  const userId = users.records[0].sys_id;

  const prefs = await client.queryTable<{ value: string }>('sys_user_preference', {
    query: `user=${userId}^name=sys_update_set`,
    fields: ['value'],
    limit: 1,
  });
  const setId = prefs.records[0]?.value;
  if (!setId) return { sysId: '', name: 'Default' };

  const set = await client.getRecord<{ sys_id: string; name: string; state: string }>(
    'sys_update_set',
    setId,
    ['sys_id', 'name', 'state'],
  );
  return { sysId: set.sys_id, name: set.name, state: set.state };
}

/**
 * Write gate. Called as the first line of every write tool handler.
 * Returns the active update set so tools can echo it back to the user.
 */
export async function assertWritable(
  client: SnClient,
  cfg: Config,
): Promise<UpdateSetInfo | undefined> {
  if (!cfg.allowWrites) {
    throw new SnApiError({
      status: 409,
      message: 'Writes are disabled. Set SN_MCP_ALLOW_WRITES=true and restart the MCP server.',
    });
  }
  if (!cfg.requireUpdateSet) return undefined;

  const current = await getCurrentUpdateSet(client, cfg);
  if (current.name === 'Default') {
    throw new SnApiError({
      status: 409,
      message:
        'Refusing write: current update set is "Default". Select a named update set first ' +
        '(servicenow_set_current_update_set) or set SN_MCP_REQUIRE_UPDATE_SET=false.',
    });
  }
  return current;
}

/**
 * Points the user's session at another update set by upserting the
 * sys_user_preference row. Intentionally NOT blocked by the "Default"
 * check — otherwise you could never switch away from Default.
 */
export async function setCurrentUpdateSet(
  client: SnClient,
  cfg: Config,
  updateSetSysId: string,
): Promise<UpdateSetInfo> {
  const set = await client.getRecord<{ sys_id: string; name: string; state: string }>(
    'sys_update_set',
    updateSetSysId,
    ['sys_id', 'name', 'state'],
  );

  const users = await client.queryTable<{ sys_id: string }>('sys_user', {
    query: `user_name=${cfg.username}`,
    fields: ['sys_id'],
    limit: 1,
  });
  if (users.records.length === 0) {
    throw new SnApiError({
      status: 404,
      message: `User "${cfg.username}" not found on the instance`,
    });
  }
  const userId = users.records[0].sys_id;

  const prefs = await client.queryTable<{ sys_id: string }>('sys_user_preference', {
    query: `user=${userId}^name=sys_update_set`,
    fields: ['sys_id'],
    limit: 1,
  });
  if (prefs.records.length > 0) {
    await client.updateRecord('sys_user_preference', prefs.records[0].sys_id, {
      value: set.sys_id,
    });
  } else {
    await client.createRecord('sys_user_preference', {
      user: userId,
      name: 'sys_update_set',
      value: set.sys_id,
    });
  }
  return { sysId: set.sys_id, name: set.name, state: set.state };
}
