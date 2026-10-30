# Deployment metadata

`render.schema.json` is the official Render Blueprint JSON Schema downloaded from
<https://render.com/schema/render.yaml.json> on 2026-10-29. It is vendored unchanged
so `npm run deployment:validate` works without network access. Its `$id` identifies
the upstream schema; Render owns the schema. Dashboard/account-level validation
still happens when you create or sync the Blueprint.

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the complete walkthrough. Production
secrets belong in Render's environment settings, not in this directory or YAML.
