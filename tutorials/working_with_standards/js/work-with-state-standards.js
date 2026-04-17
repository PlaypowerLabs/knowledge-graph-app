/* ================================
   CONFIGURATION & SETUP
   ================================ */

// Dependencies
require('dotenv').config();

// Constants
const MIDDLE_SCHOOL_GRADES = ['6', '7', '8'];

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

    // Handle array parameters (like gradeLevel)
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
   STEP 2: QUERY FOR STANDARDS DATA
   ================================ */

async function getCaliforniaFramework() {
  const result = await makeApiRequest('/standards-frameworks', {
    jurisdiction: 'California',
    academicSubject: 'Mathematics'
  });

  const californiaFramework = result.data[0] || null;

  console.log('✅ Retrieved California math standards framework:');
  if (californiaFramework) {
    console.log(californiaFramework);
  }

  return californiaFramework;
}

async function getMiddleSchoolStandardsGroupings(frameworkUuid) {
  const result = await makeApiRequest('/academic-standards', {
    standardsFrameworkCaseIdentifierUUID: frameworkUuid,
    normalizedStatementType: 'Standard Grouping',
    gradeLevel: MIDDLE_SCHOOL_GRADES
  });

  const groupings = result.data;

  console.log(`✅ Retrieved ${groupings.length} standard groupings for middle school math in California`);
  groupings.slice(0, 5).forEach(grouping => {
    const description = grouping.description || 'No description';
    const truncated = description.length > 80 ? description.substring(0, 80) + '...' : description;
    console.log(`  ${grouping.statementCode || 'N/A'}: ${truncated}`);
  });

  return groupings;
}

async function getMiddleSchoolStandards(frameworkUuid) {
  const result = await makeApiRequest('/academic-standards', {
    standardsFrameworkCaseIdentifierUUID: frameworkUuid,
    normalizedStatementType: 'Standard',
    gradeLevel: MIDDLE_SCHOOL_GRADES
  });

  const standards = result.data;

  console.log(`✅ Retrieved ${standards.length} standards for California middle school mathematics`);
  standards.slice(0, 5).forEach(standard => {
    const description = standard.description || 'No description';
    const truncated = description.length > 80 ? description.substring(0, 80) + '...' : description;
    console.log(`  ${standard.statementCode || 'N/A'}: ${truncated}`);
  });

  return standards;
}

/* ================================
   MAIN EXECUTION
   ================================ */

async function main() {
  console.log('\n=== WORKING WITH STATE STANDARDS TUTORIAL ===\n');

  console.log('🔄 Step 2: Querying for standards data...\n');

  // 1. Get California math standards framework
  const californiaFramework = await getCaliforniaFramework();

  if (!californiaFramework) {
    console.error('❌ Could not retrieve California framework');
    process.exit(1);
  }

  const frameworkUuid = californiaFramework.caseIdentifierUUID;

  // 2. Get middle school standard groupings
  console.log();
  await getMiddleSchoolStandardsGroupings(frameworkUuid);

  // 3. Get middle school standards
  console.log();
  await getMiddleSchoolStandards(frameworkUuid);
}

main().catch(console.error);
