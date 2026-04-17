/* ================================
   CONFIGURATION & SETUP
   ================================ */

// Dependencies
require('dotenv').config();

// Domain Constants
// Pick a CCSSM standard to find its best state standard matches
const TARGET_CCSSM_STANDARD_CODE = '6.EE.B.5';  // Common Core 6th grade math standard on solving equations and inequalities
const TARGET_CCSSM_JURISDICTION = 'Multi-State';

// Environment setup
const apiKey = process.env.API_KEY;
const baseUrl = process.env.BASE_URL;

if (!apiKey) {
  console.error('❌ API_KEY environment variable is not set.');
  process.exit(1);
}

if (!baseUrl) {
  console.error('❌ BASE_URL environment variable is not set.');
  process.exit(1);
}

/* ================================
   HELPER FUNCTIONS
   ================================ */

async function makeApiRequest(endpoint, params = {}) {
  try {
    const url = new URL(`${baseUrl}${endpoint}`);

    // Handle array parameters
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => url.searchParams.append(key, v));
      } else {
        url.searchParams.append(key, value);
      }
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`❌ Error making API request to ${endpoint}: ${error.message}`);
    throw error;
  }
}

/* ================================
   STEP 2: FIND THE BEST-MATCHING STATE STANDARDS
   ================================ */

async function findBestStateMatches() {
  // Find the CCSSM standard by its statement code and jurisdiction
  const searchResult = await makeApiRequest('/academic-standards/search', {
    statementCode: TARGET_CCSSM_STANDARD_CODE,
    jurisdiction: TARGET_CCSSM_JURISDICTION
  });

  const ccssmStandard = searchResult[0] || null;

  if (!ccssmStandard) {
    console.log(`❌ CCSSM standard not found: ${TARGET_CCSSM_STANDARD_CODE}`);
    return { ccssmStandard: null, texasMatches: null };
  }

  const ccssmStandardUuid = ccssmStandard.caseIdentifierUUID;
  console.log(`✅ Found CCSSM standard: ${TARGET_CCSSM_STANDARD_CODE}`);
  console.log(`  Case UUID: ${ccssmStandardUuid}`);
  console.log(`  Description: ${ccssmStandard.description}`);

  // Get Texas standards that align with this CCSSM standard
  const crosswalkResult = await makeApiRequest(
    `/academic-standards/${ccssmStandardUuid}/crosswalks`,
    { jurisdiction: 'Texas' }
  );

  const texasMatches = crosswalkResult.data;

  if (!texasMatches || texasMatches.length === 0) {
    console.log(`\n❌ No Texas standard matches found for ${TARGET_CCSSM_STANDARD_CODE}`);
    return { ccssmStandard, texasMatches: null };
  }

  // Sort by Jaccard score (highest first)
  const texasMatchesSorted = texasMatches.sort((a, b) => b.jaccard - a.jaccard);

  console.log(`\n✅ Found ${texasMatchesSorted.length} Texas standard matches`);
  console.log(`\n📊 Top Texas match (highest Jaccard score):`);

  const topMatch = texasMatchesSorted[0];
  console.log(`  Statement Code: ${topMatch.statementCode}`);
  console.log(`  Jaccard Score: ${topMatch.jaccard.toFixed(4)}`);
  console.log(`  Shared LC Count: ${topMatch.sharedLCCount}`);
  console.log(`  State LC Count: ${topMatch.stateLCCount}`);
  console.log(`  CCSS LC Count: ${topMatch.ccssLCCount}`);

  return { ccssmStandard, texasMatches: texasMatchesSorted };
}

/* ================================
   STEP 3: INTERPRET THE RELATIONSHIP METRICS
   ================================ */

function interpretRelationshipMetrics(matches) {
  if (!matches || matches.length === 0) {
    return;
  }

  console.log(`\n📊 INTERPRETATION OF TOP MATCHES:\n`);

  // Show top 5 matches with interpretation
  matches.slice(0, 5).forEach((match, idx) => {
    const jaccard = match.jaccard;
    const stateLc = match.stateLCCount;
    const ccssLc = match.ccssLCCount;
    const sharedLc = match.sharedLCCount;

    console.log(`Match #${idx + 1}:`);
    console.log(`  Statement Code: ${match.statementCode}`);
    console.log(`  Jaccard Score: ${jaccard.toFixed(4)}`);
    console.log(`  State LC Count: ${stateLc}`);
    console.log(`  CCSS LC Count: ${ccssLc}`);
    console.log(`  Shared LC Count: ${sharedLc}`);

    // Interpret the metrics
    let interpretation;
    if (jaccard >= 0.9) {
      interpretation = "Very strong overlap; standards share nearly all skills";
    } else if (jaccard >= 0.7) {
      interpretation = "Strong overlap; substantial shared skills";
    } else if (jaccard >= 0.5) {
      interpretation = "Moderate overlap; many shared skills";
    } else if (jaccard >= 0.3) {
      interpretation = "Partial overlap; some shared skills";
    } else {
      interpretation = "Weak overlap; few shared skills";
    }

    // Check scope balance
    let scopeNote;
    if (Math.abs(stateLc - ccssLc) <= 2) {
      scopeNote = "Both standards have similar scope";
    } else if (stateLc > ccssLc) {
      scopeNote = "State standard covers more content";
    } else {
      scopeNote = "CCSS standard covers more content";
    }

    console.log(`  Interpretation: ${interpretation}`);
    console.log(`  Scope: ${scopeNote}`);
    console.log();
  });
}

/* ================================
   STEP 4: INSPECT SHARED LEARNING COMPONENTS
   ================================ */

async function showSharedLearningComponents(ccssmStandard, topMatch) {
  const ccssmStandardUuid = ccssmStandard.caseIdentifierUUID;
  const stateStandardUuid = topMatch.caseIdentifierUUID;

  // Get LCs that support the CCSS standard
  const ccssLcResult = await makeApiRequest(
    `/academic-standards/${ccssmStandardUuid}/learning-components`
  );
  const ccssLcs = ccssLcResult.data;

  // Get LCs that support the state standard
  const stateLcResult = await makeApiRequest(
    `/academic-standards/${stateStandardUuid}/learning-components`
  );
  const stateLcs = stateLcResult.data;

  // Create sets of LC identifiers for comparison
  const ccssLcIds = new Set(ccssLcs.map(lc => lc.identifier));
  const stateLcIds = new Set(stateLcs.map(lc => lc.identifier));

  // Find shared and unique LCs
  const sharedLcIds = new Set([...ccssLcIds].filter(id => stateLcIds.has(id)));
  const ccssOnlyIds = new Set([...ccssLcIds].filter(id => !stateLcIds.has(id)));
  const stateOnlyIds = new Set([...stateLcIds].filter(id => !ccssLcIds.has(id)));

  // Get LC descriptions
  const sharedLcs = ccssLcs.filter(lc => sharedLcIds.has(lc.identifier));
  const ccssOnlyLcs = ccssLcs.filter(lc => ccssOnlyIds.has(lc.identifier));
  const stateOnlyLcs = stateLcs.filter(lc => stateOnlyIds.has(lc.identifier));

  console.log(`\n✅ LEARNING COMPONENTS ANALYSIS:`);
  console.log(`CCSS Standard: ${ccssmStandard.statementCode}`);
  console.log(`State Standard: ${topMatch.statementCode}`);
  console.log();

  console.log(`📊 SHARED LEARNING COMPONENTS (${sharedLcs.length}):`);
  sharedLcs.forEach((lc, idx) => {
    console.log(`  ✅ ${idx + 1}. ${lc.description}`);
  });
  console.log();

  console.log(`📊 CCSS-ONLY LEARNING COMPONENTS (${ccssOnlyLcs.length}):`);
  ccssOnlyLcs.forEach((lc, idx) => {
    console.log(`  ➕ ${idx + 1}. ${lc.description}`);
  });
  console.log();

  console.log(`📊 STATE-ONLY LEARNING COMPONENTS (${stateOnlyLcs.length}):`);
  stateOnlyLcs.forEach((lc, idx) => {
    console.log(`  ➖ ${idx + 1}. ${lc.description}`);
  });
  console.log();
}

/* ================================
   MAIN EXECUTION
   ================================ */

async function main() {
  console.log('\n=== USING CROSSWALKS TO COMPARE STATE STANDARDS TO COMMON CORE ===\n');

  console.log('🔄 Step 2: Find the best-matching state standards for a CCSSM standard...\n');
  const { ccssmStandard, texasMatches } = await findBestStateMatches();

  if (texasMatches) {
    console.log('\n' + '='.repeat(70));
    console.log('🔄 Step 3: Interpret the relationship metrics...');
    interpretRelationshipMetrics(texasMatches);

    console.log('='.repeat(70));
    console.log('🔄 Step 4: Inspect shared learning components...');
    await showSharedLearningComponents(ccssmStandard, texasMatches[0]);
  }
}

main().catch(console.error);
