// Picks where Job Radar keeps your data: the hosted server (Azure) when the page is served from it,
// otherwise your own private GitHub repo.
import * as github from "./gh.js";
import * as azure from "./az.js";

const hosted = await azure.detect();
const backend = hosted ? azure : { mode: "github", ...github };
export default backend;
