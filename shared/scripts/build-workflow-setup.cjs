/* Builds a one-time SQL Editor repair for projects still on migrations 001-006.
 * No network access or database credentials; the canonical migrations stay intact.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const migrations = ['007_assistant_management.sql', '008_item_handoffs_chat.sql', '009_admin_operations.sql', '010_assistant_delivery_workload.sql'];

function buildWorkflowSetup() {
  const bodies = migrations.map(name => {
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8').replace(/\r\n/g, '\n');
    if ((sql.match(/^begin;$/gm) || []).length !== 1 || !/\ncommit;\s*$/.test(sql)) {
      throw new Error('Unexpected transaction structure in ' + name);
    }
    return '-- ' + name + '\n' + sql.replace(/^begin;\n/m, '').replace(/\ncommit;\s*$/, '\n');
  });
  return `-- Community Services: missing assistant, chat and admin setup (007-010).
-- Run the ENTIRE file once in this project's Supabase SQL Editor as postgres.
-- Requires migrations 001-006. Do not also run 007-010 individually.
-- Existing application data is preserved. Any error rolls the whole update back.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $preflight$
declare object_name text;
begin
  foreach object_name in array array['profiles','assistants','requests','assignments','donations','reports','developer_accounts'] loop
    if to_regclass('public.' || object_name) is null then
      raise exception 'Missing base table %. Apply migrations 001-006 first.', object_name;
    end if;
  end loop;
  if to_regprocedure('public.cancel_resource_request(uuid)') is null
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='requests' and column_name='item_name')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='reports' and column_name='longitude') then
    raise exception 'Base workflow setup is incomplete. Apply migrations 001-006 first.';
  end if;
  foreach object_name in array array['assistant_reviews','item_handoffs','chat_messages','admin_report_reviews','admin_actions'] loop
    if to_regclass('public.' || object_name) is not null then
      raise exception 'Workflow table % already exists. Stop and check which individual migrations are outstanding; this bundle is only for projects missing all of 007-009.', object_name;
    end if;
  end loop;
end;
$preflight$;

${bodies.join('\n')}
-- Refresh the API schema only after the entire update commits successfully.
notify pgrst, 'reload schema';
commit;

select 'Assistant, chat and admin setup complete. Refresh the website.' as result;
`;
}

if (require.main === module) {
  const output = path.resolve(__dirname, '../../test-results/community-workflows-setup.sql');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, buildWorkflowSetup());
  console.log('SQL setup file created: ' + output);
  console.log('Not applied to any database. Run the entire file in the project Supabase SQL Editor.');
}
module.exports = { buildWorkflowSetup };
