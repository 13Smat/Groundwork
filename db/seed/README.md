# Seed

Demo workspace and sample catalog data go here. The seed is our own data.

`starter-pack.json` is the paving and landscaping starter. Names, prices, and formulas were written for Groundwork. `POST /catalog-items/starter-pack` inserts it into the current workspace for a member with `catalog.manage`. A second call skips a catalog SKU, a takeoff name, or a recipe name that is already there. Recipes are inserted as drafts. ADR 0011.

`fixtures/rgbir-cog.tif` is a synthetic 4-band chip for local and CI tile tests. The imagery migration seeds the registry rows. Nothing here is pulled from a state imagery service.

`demo.json` is the clean-room demo workspace: Cedar Ridge Paving, two clients, two sites inside the fixture COG, and one job. `pnpm db:seed` inserts it as `groundwork_app` with workspace context, then loads `starter-pack.json`. A second run inserts nothing. It does not upload the COG and it does not create a login. ADR 0022.
