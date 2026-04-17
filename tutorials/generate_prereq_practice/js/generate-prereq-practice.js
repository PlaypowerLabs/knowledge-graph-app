/* ================================
   CONFIGURATION & SETUP
   ================================ */

// Dependencies
const OpenAI = require('openai');
require('dotenv').config();

// Constants
const GENERATE_PRACTICE = true;
const TARGET_CODE = '6.NS.B.4';
// OpenAI configuration
const OPENAI_MODEL = 'gpt-4';
const OPENAI_TEMPERATURE = 0.7;

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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
   STEP 2: GET PREREQUISITE STANDARDS
   ================================ */

async function getStandardAndPrerequisites() {
  // Find the target standard by statement code
  const searchResult = await makeApiRequest('/academic-standards/search', {
    statementCode: TARGET_CODE,
    jurisdiction: 'Multi-State'
  });

  const targetStandard = searchResult[0] || null;

  if (!targetStandard) {
    console.error(`❌ No standard found for ${TARGET_CODE}`);
    return null;
  }

  console.log(`✅ Found standard ${TARGET_CODE}:`);
  console.log(`  UUID: ${targetStandard.caseIdentifierUUID}`);
  console.log(`  Description: ${targetStandard.description}`);

  // Get prerequisites
  const prereqResult = await makeApiRequest(
    `/academic-standards/${targetStandard.caseIdentifierUUID}/prerequisites`
  );

  const prerequisiteStandards = prereqResult.data;
  console.log(`✅ Found ${prerequisiteStandards.length} prerequisite(s):`);
  prerequisiteStandards.forEach(prereq => {
    const description = prereq.description || 'No description';
    const truncated = description.length > 80 ? description.substring(0, 80) + '...' : description;
    console.log(`  ${prereq.statementCode}: ${truncated}`);
  });

  return { targetStandard, prerequisiteStandards };
}

async function getLearningComponentsForPrerequisites(prerequisiteStandards) {
  const prerequisiteLearningComponents = [];

  for (const prereq of prerequisiteStandards) {
    const lcResult = await makeApiRequest(
      `/academic-standards/${prereq.caseIdentifierUUID}/learning-components`
    );

    for (const lc of lcResult.data) {
      prerequisiteLearningComponents.push({
        caseIdentifierUUID: prereq.caseIdentifierUUID,
        statementCode: prereq.statementCode,
        standardDescription: prereq.description,
        learningComponentDescription: lc.description
      });
    }
  }

  console.log(`✅ Found ${prerequisiteLearningComponents.length} supporting learning components for prerequisites:`);
  prerequisiteLearningComponents.slice(0, 5).forEach(lc => {
    const description = lc.learningComponentDescription || 'No description';
    const truncated = description.length > 80 ? description.substring(0, 80) + '...' : description;
    console.log(`  ${truncated}`);
  });

  return prerequisiteLearningComponents;
}

/* ================================
   STEP 3: GENERATE PRACTICE
   ================================ */

function packageContextData(targetStandard, prerequisiteLearningComponents) {
  /* Package the standards and learning components data for text generation
   * This creates a structured context that can be used for generating practice questions
   */

  const standardsMap = new Map();

  // Group learning components by standard for context
  for (const row of prerequisiteLearningComponents) {
    if (!standardsMap.has(row.caseIdentifierUUID)) {
      standardsMap.set(row.caseIdentifierUUID, {
        statementCode: row.statementCode,
        description: row.standardDescription || '(no statement)',
        supportingLearningComponents: []
      });
    }

    standardsMap.get(row.caseIdentifierUUID).supportingLearningComponents.push({
      description: row.learningComponentDescription || '(no description)'
    });
  }

  const fullStandardsContext = {
    targetStandard: {
      statementCode: targetStandard.statementCode,
      description: targetStandard.description || '(no statement)'
    },
    prereqStandards: Array.from(standardsMap.values())
  };

  console.log('✅ Packaged full standards context for text generation');
  return fullStandardsContext;
}

async function generatePractice(fullStandardsContext) {
  console.log(`🔄 Generating practice questions for ${fullStandardsContext.targetStandard.statementCode}...`);

  try {
    // Build prompt inline
    let prerequisiteText = '';
    for (const prereq of fullStandardsContext.prereqStandards) {
      prerequisiteText += `- ${prereq.statementCode}: ${prereq.description}\n`;
      prerequisiteText += '  Supporting Learning Components:\n';
      for (const lc of prereq.supportingLearningComponents) {
        prerequisiteText += `    • ${lc.description}\n`;
      }
    }

    const prompt = `You are a math tutor helping middle school students. Based on the following information, generate 3 practice questions for the target standard. Questions should help reinforce the key concept and build on prerequisite knowledge.

Target Standard:
- ${fullStandardsContext.targetStandard.statementCode}: ${fullStandardsContext.targetStandard.description}

Prerequisite Standards & Supporting Learning Components:
${prerequisiteText}`;

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert middle school math tutor.' },
        { role: 'user', content: prompt }
      ],
      temperature: OPENAI_TEMPERATURE
    });

    const practiceQuestions = response.choices[0].message.content.trim();

    console.log(`✅ Generated practice questions:\n`);
    console.log(practiceQuestions);

    return {
      aiGenerated: practiceQuestions,
      targetStandard: fullStandardsContext.targetStandard.statementCode,
      prerequisiteCount: fullStandardsContext.prereqStandards.length
    };
  } catch (err) {
    console.error('❌ Error generating practice questions:', err.message);
    throw err;
  }
}

/* ================================
   MAIN EXECUTION
   ================================ */

async function main() {
  console.log('\n=== GENERATE PREREQUISITE PRACTICE TUTORIAL ===\n');

  console.log('🔄 Step 2: Get prerequisite standards for 6.NS.B.4...\n');

  // Get target standard and prerequisites
  const prerequisiteData = await getStandardAndPrerequisites();

  if (!prerequisiteData) {
    console.error('❌ Failed to find prerequisite data');
    return;
  }

  const { targetStandard, prerequisiteStandards } = prerequisiteData;

  // Get learning components for prerequisites
  console.log();
  const prerequisiteLearningComponents = await getLearningComponentsForPrerequisites(prerequisiteStandards);

  console.log('\n🔄 Step 3: Generate practice problems...\n');
  const fullStandardsContext = packageContextData(targetStandard, prerequisiteLearningComponents);

  if (GENERATE_PRACTICE) {
    await generatePractice(fullStandardsContext);
  } else {
    console.log('🚫 Practice question generation disabled');
  }
}

main().catch(console.error);
