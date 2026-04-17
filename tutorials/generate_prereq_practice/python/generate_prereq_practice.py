#!/usr/bin/env python3
"""
================================
CONFIGURATION & SETUP
================================
"""

# Dependencies
import os
import sys
import requests
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

# Domain Constants
GENERATE_PRACTICE = True
TARGET_CODE = '6.NS.B.4'
# OpenAI configuration
OPENAI_MODEL = 'gpt-4'
OPENAI_TEMPERATURE = 0.7

# Environment Setup
api_key = os.getenv('API_KEY')
base_url = os.getenv('BASE_URL')

if not api_key:
    print('❌ API_KEY environment variable is not set.')
    sys.exit(1)

if not base_url:
    print('❌ BASE_URL environment variable is not set.')
    sys.exit(1)

openai_client = OpenAI(
    api_key=os.getenv('OPENAI_API_KEY')
)

# Setup headers for API requests
headers = {"x-api-key": api_key}


"""
================================
HELPER FUNCTIONS
================================
"""

def make_api_request(endpoint, params=None):
    """Make API request to Knowledge Graph API"""
    try:
        url = f"{base_url}{endpoint}"
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as error:
        print(f'❌ Error making API request to {endpoint}: {str(error)}')
        raise error


"""
================================
STEP 2: GET PREREQUISITE STANDARDS
================================
"""

def get_standard_and_prerequisites():
    """Find the target standard and its prerequisites"""

    # Find the target standard by statement code
    search_result = make_api_request(
        '/academic-standards/search',
        params={
            'statementCode': TARGET_CODE,
            'jurisdiction': 'Multi-State'
        }
    )

    target_standard = search_result[0] if search_result else None

    if not target_standard:
        print(f'❌ No standard found for {TARGET_CODE}')
        return None

    print(f'✅ Found standard {TARGET_CODE}:')
    print(f'  UUID: {target_standard["caseIdentifierUUID"]}')
    print(f'  Description: {target_standard["description"]}')

    # Get prerequisites
    prereq_result = make_api_request(
        f'/academic-standards/{target_standard["caseIdentifierUUID"]}/prerequisites'
    )

    prerequisite_standards = prereq_result['data']
    print(f'✅ Found {len(prerequisite_standards)} prerequisite(s):')
    for prereq in prerequisite_standards:
        description = prereq.get('description', 'No description')
        truncated = description[:80] + '...' if len(description) > 80 else description
        print(f'  {prereq["statementCode"]}: {truncated}')

    return {'target_standard': target_standard, 'prerequisite_standards': prerequisite_standards}


def get_learning_components_for_prerequisites(prerequisite_standards):
    """Get learning components for each prerequisite standard"""

    prerequisite_learning_components = []

    for prereq in prerequisite_standards:
        lc_result = make_api_request(
            f'/academic-standards/{prereq["caseIdentifierUUID"]}/learning-components'
        )

        for lc in lc_result['data']:
            prerequisite_learning_components.append({
                'caseIdentifierUUID': prereq['caseIdentifierUUID'],
                'statementCode': prereq['statementCode'],
                'standardDescription': prereq['description'],
                'learningComponentDescription': lc['description']
            })

    print(f'✅ Found {len(prerequisite_learning_components)} supporting learning components for prerequisites:')
    for lc in prerequisite_learning_components[:5]:
        description = lc.get('learningComponentDescription', 'No description')
        truncated = description[:80] + '...' if len(description) > 80 else description
        print(f'  {truncated}')

    return prerequisite_learning_components


"""
================================
STEP 3: GENERATE PRACTICE
================================
"""

def package_context_data(target_standard, prerequisite_learning_components):
    """
    Package the standards and learning components data for text generation
    This creates a structured context that can be used for generating practice questions
    """

    standards_map = {}

    # Group learning components by standard for context
    for row in prerequisite_learning_components:
        case_id = row['caseIdentifierUUID']
        if case_id not in standards_map:
            standards_map[case_id] = {
                'statementCode': row['statementCode'],
                'description': row['standardDescription'] or '(no statement)',
                'supportingLearningComponents': []
            }

        standards_map[case_id]['supportingLearningComponents'].append({
            'description': row['learningComponentDescription'] or '(no description)'
        })

    full_standards_context = {
        'targetStandard': {
            'statementCode': target_standard['statementCode'],
            'description': target_standard['description'] or '(no statement)'
        },
        'prereqStandards': list(standards_map.values())
    }

    print('✅ Packaged full standards context for text generation')
    return full_standards_context


def generate_practice(full_standards_context):
    """Generate practice questions using OpenAI API"""
    print(f'🔄 Generating practice questions for {full_standards_context["targetStandard"]["statementCode"]}...')

    try:
        # Build prompt inline
        prerequisite_text = ''
        for prereq in full_standards_context['prereqStandards']:
            prerequisite_text += f'- {prereq["statementCode"]}: {prereq["description"]}\n'
            prerequisite_text += '  Supporting Learning Components:\n'
            for lc in prereq['supportingLearningComponents']:
                prerequisite_text += f'    • {lc["description"]}\n'

        prompt = f"""You are a math tutor helping middle school students. Based on the following information, generate 3 practice questions for the target standard. Questions should help reinforce the key concept and build on prerequisite knowledge.

Target Standard:
- {full_standards_context["targetStandard"]["statementCode"]}: {full_standards_context["targetStandard"]["description"]}

Prerequisite Standards & Supporting Learning Components:
{prerequisite_text}"""

        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {'role': 'system', 'content': 'You are an expert middle school math tutor.'},
                {'role': 'user', 'content': prompt}
            ],
            temperature=OPENAI_TEMPERATURE
        )

        practice_questions = response.choices[0].message.content.strip()

        print('✅ Generated practice questions:\n')
        print(practice_questions)

        return {
            'aiGenerated': practice_questions,
            'targetStandard': full_standards_context['targetStandard']['statementCode'],
            'prerequisiteCount': len(full_standards_context['prereqStandards'])
        }
    except Exception as err:
        print(f'❌ Error generating practice questions: {str(err)}')
        raise err


"""
================================
MAIN EXECUTION
================================
"""

def main():
    """Main execution function - orchestrates all tutorial steps"""
    print('\n=== GENERATE PREREQUISITE PRACTICE TUTORIAL ===\n')

    print('🔄 Step 2: Get prerequisite standards for 6.NS.B.4...\n')

    # Get target standard and prerequisites
    prerequisite_data = get_standard_and_prerequisites()

    if not prerequisite_data:
        print('❌ Failed to find prerequisite data')
        return

    target_standard = prerequisite_data['target_standard']
    prerequisite_standards = prerequisite_data['prerequisite_standards']

    # Get learning components for prerequisites
    print()
    prerequisite_learning_components = get_learning_components_for_prerequisites(prerequisite_standards)

    print('\n🔄 Step 3: Generate practice problems...\n')
    full_standards_context = package_context_data(target_standard, prerequisite_learning_components)

    if GENERATE_PRACTICE:
        generate_practice(full_standards_context)
    else:
        print('🚫 Practice question generation disabled')


if __name__ == '__main__':
    main()
