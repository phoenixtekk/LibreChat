// In-container seed for the curated Agency Agents library. Run INSIDE the
// analytikul-app container (it has /app + the full dep tree):
//
//   docker cp scripts/seed-agency-agents.cjs analytikul-app:/tmp/seed.cjs
//   docker cp .claude/agents analytikul-app:/tmp/agency-agents
//   docker exec -e SEED_AGENTS_DIR=/tmp/agency-agents \
//               -e SEED_OWNER_EMAIL=lacy@analytikul.ai \
//               -e SEED_MODEL=claude-sonnet-4-6 \
//               -e SEED_PROVIDER=anthropic \
//               -e SEED_LIMIT=2 \
//               analytikul-app node /tmp/seed.cjs
//
// SEED_LIMIT=N runs only first N (for a test batch). Drop the var to do all.
// SEED_DRY=1 parses + reports without writing.
//
// Bypasses the HTTP API + ban-violation system entirely; uses Mongoose models
// directly inside the running app so it inherits the configured MONGO_URI.
require('module-alias')({ base: '/app/api' });
const fs = require('fs');
const path = require('path');
const { connectDb } = require('/app/api/db');
const { User } = require('/app/api/db/models');

const CURATED = [
  'business-strategist.md',
  'finance-financial-analyst.md',
  'specialized-pricing-analyst.md',
  'product-manager.md',
  'design-brand-guardian.md',
  'engineering-backend-architect.md',
  'engineering-frontend-developer.md',
  'engineering-devops-automator.md',
  'security-architect.md',
  'engineering-data-engineer.md',
  'support-analytics-reporter.md',
  'product-trend-researcher.md',
  'marketing-content-creator.md',
  'marketing-seo-specialist.md',
  'marketing-email-strategist.md',
  'project-management-project-shepherd.md',
  'testing-workflow-optimizer.md',
];

const AGENTS_DIR = process.env.SEED_AGENTS_DIR || '/tmp/agency-agents';
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL || 'lacy@analytikul.ai';
const PROVIDER = process.env.SEED_PROVIDER || 'anthropic';
const MODEL = process.env.SEED_MODEL || 'claude-sonnet-4-6';
const LIMIT = process.env.SEED_LIMIT ? Number(process.env.SEED_LIMIT) : CURATED.length;
const DRY = process.env.SEED_DRY === '1';

function parseAgent(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    return null;
  }
  const fm = m[1];
  const body = m[2].trim();
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const description = (fm.match(/^description:\s*(.+)$/m) || [])[1]?.trim();
  if (!name || !body) {
    return null;
  }
  return {
    name,
    description: (description || '').slice(0, 480) || null,
    instructions: body.length > 12000 ? `${body.slice(0, 12000)}\n…` : body,
  };
}

async function main() {
  await connectDb();
  console.log('connected to mongo.');
  const owner = await User.findOne({ email: OWNER_EMAIL }).lean();
  if (!owner) {
    throw new Error(`owner not found: ${OWNER_EMAIL}`);
  }
  const ownerId = String(owner._id);
  console.log(`owner: ${owner.email} (${ownerId})`);

  // Lazy-require nanoid + the createAgent helper + grantPermission from the
  // same app. grantPermission mirrors what the HTTP controller does after
  // create, so the seeded agents have proper owner ACLs.
  const { nanoid } = await import('nanoid');
  const { createAgent } = require('/app/api/models');
  const { grantPermission } = require('/app/api/server/services/PermissionService');
  const {
    PrincipalType,
    ResourceType,
    AccessRoleIds,
  } = require('librechat-data-provider');

  const files = CURATED.slice(0, LIMIT);
  console.log(`seeding ${files.length}/${CURATED.length} curated agents (DRY=${DRY ? 'yes' : 'no'})`);

  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const full = path.join(AGENTS_DIR, f);
    if (!fs.existsSync(full)) {
      console.log(`  SKIP   ${f} (missing)`);
      continue;
    }
    const parsed = parseAgent(full);
    if (!parsed) {
      console.log(`  SKIP   ${f} (unparseable)`);
      continue;
    }
    const agentData = {
      id: `agent_${nanoid()}`,
      author: owner._id,
      name: `[A] ${parsed.name}`,
      description: parsed.description,
      instructions: parsed.instructions,
      provider: PROVIDER,
      model: MODEL,
      model_parameters: {},
      tools: [],
      category: 'general',
    };
    if (DRY) {
      console.log(`  DRY    ${agentData.name} (${parsed.instructions.length} chars)`);
      ok++;
      continue;
    }
    try {
      const agent = await createAgent(agentData);
      await Promise.all([
        grantPermission({
          principalType: PrincipalType.USER,
          principalId: owner._id,
          resourceType: ResourceType.AGENT,
          resourceId: agent._id,
          accessRoleId: AccessRoleIds.AGENT_OWNER,
          grantedBy: owner._id,
        }),
        grantPermission({
          principalType: PrincipalType.USER,
          principalId: owner._id,
          resourceType: ResourceType.REMOTE_AGENT,
          resourceId: agent._id,
          accessRoleId: AccessRoleIds.REMOTE_AGENT_OWNER,
          grantedBy: owner._id,
        }),
      ]);
      console.log(`  OK     ${agentData.name} -> ${agent.id} (+ACL)`);
      ok++;
    } catch (err) {
      console.log(`  FAIL   ${agentData.name}: ${err.message}`);
      fail++;
    }
  }
  console.log(`\ndone. created=${ok} failed=${fail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
