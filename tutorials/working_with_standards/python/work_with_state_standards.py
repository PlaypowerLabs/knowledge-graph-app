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

# Load environment variables
load_dotenv()

# Domain Constants
MIDDLE_SCHOOL_GRADES = ['6', '7', '8']

# Environment Setup
api_key = os.getenv('API_KEY')
base_url = os.getenv('BASE_URL')

if not api_key:
    print('❌ API_KEY environment variable is not set.')
    sys.exit(1)

if not base_url:
    print('❌ BASE_URL environment variable is not set.')
    sys.exit(1)

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
STEP 2: QUERY FOR STANDARDS DATA
================================
"""

def get_california_framework():
    """Get California math standards framework"""
    result = make_api_request(
        '/standards-frameworks',
        params={
            'jurisdiction': 'California',
            'academicSubject': 'Mathematics'
        }
    )

    california_framework = result['data'][0] if result['data'] else None

    print(f'✅ Retrieved California math standards framework:')
    if california_framework:
        print(california_framework)

    return california_framework


def get_middle_school_standards_groupings(framework_uuid):
    """Get middle school standard groupings from California framework"""
    params = {
        'standardsFrameworkCaseIdentifierUUID': framework_uuid,
        'normalizedStatementType': 'Standard Grouping',
        'gradeLevel': MIDDLE_SCHOOL_GRADES
    }

    result = make_api_request('/academic-standards', params=params)
    groupings = result['data']

    print(f'✅ Retrieved {len(groupings)} standard groupings for middle school math in California')
    for grouping in groupings[:5]:
        description = grouping.get('description', 'No description')
        truncated = description[:80] + '...' if len(description) > 80 else description
        print(f'  {grouping.get("statementCode", "N/A")}: {truncated}')

    return groupings


def get_middle_school_standards(framework_uuid):
    """Get all standards for California middle school mathematics"""
    params = {
        'standardsFrameworkCaseIdentifierUUID': framework_uuid,
        'normalizedStatementType': 'Standard',
        'gradeLevel': MIDDLE_SCHOOL_GRADES
    }

    result = make_api_request('/academic-standards', params=params)
    standards = result['data']

    print(f'✅ Retrieved {len(standards)} standards for California middle school mathematics')
    for standard in standards[:5]:
        description = standard.get('description', 'No description')
        truncated = description[:80] + '...' if len(description) > 80 else description
        print(f'  {standard.get("statementCode", "N/A")}: {truncated}')

    return standards


"""
================================
MAIN EXECUTION
================================
"""

def main():
    """Main execution function - orchestrates all tutorial steps"""
    print('\n=== WORKING WITH STATE STANDARDS TUTORIAL ===\n')

    print('🔄 Step 2: Querying for standards data...\n')

    # 1. Get California math standards framework
    california_framework = get_california_framework()

    if not california_framework:
        print('❌ Could not retrieve California framework')
        sys.exit(1)

    framework_uuid = california_framework['caseIdentifierUUID']

    # 2. Get middle school standard groupings
    print()
    groupings = get_middle_school_standards_groupings(framework_uuid)

    # 3. Get middle school standards
    print()
    standards = get_middle_school_standards(framework_uuid)


if __name__ == '__main__':
    main()
