#!/usr/bin/env python3
"""
Using crosswalks to compare state standards to Common Core

This tutorial demonstrates how to use the crosswalk data in Knowledge Graph to compare
standards between the Common Core State Standards (CCSSM) and state frameworks. These
crosswalks help determine which state standards are most similar to a given CCSSM standard
and understand the similarities and differences between them.

Crosswalks are evidence-based relationships between state standards and CCSSM standards,
derived from overlapping sets of Learning Components (LCs). Each crosswalk includes
similarity metrics, such as the Jaccard score and relative LC counts, to help interpret
how closely two standards align.
"""

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
# Pick a CCSSM standard to find its best state standard matches
TARGET_CCSSM_STANDARD_CODE = '6.EE.B.5'  # Common Core 6th grade math standard on solving equations and inequalities
TARGET_CCSSM_JURISDICTION = 'Multi-State'

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
STEP 2: FIND THE BEST-MATCHING STATE STANDARDS
================================
"""

def find_best_state_matches():
    """
    Find the best state standard matches for a CCSSM standard

    Returns:
        tuple: (ccssm_standard, texas_matches)
    """
    # Find the CCSSM standard by its statement code and jurisdiction
    search_result = make_api_request(
        '/academic-standards/search',
        params={
            'statementCode': TARGET_CCSSM_STANDARD_CODE,
            'jurisdiction': TARGET_CCSSM_JURISDICTION
        }
    )

    ccssm_standard = search_result[0] if search_result else None

    if not ccssm_standard:
        print(f'❌ CCSSM standard not found: {TARGET_CCSSM_STANDARD_CODE}')
        return None, None

    ccssm_standard_uuid = ccssm_standard['caseIdentifierUUID']
    print(f'✅ Found CCSSM standard: {TARGET_CCSSM_STANDARD_CODE}')
    print(f'  Case UUID: {ccssm_standard_uuid}')
    print(f'  Description: {ccssm_standard["description"]}')

    # Get Texas standards that align with this CCSSM standard
    crosswalk_result = make_api_request(
        f'/academic-standards/{ccssm_standard_uuid}/crosswalks',
        params={'jurisdiction': 'Texas'}
    )

    texas_matches = crosswalk_result['data']

    if not texas_matches:
        print(f'\n❌ No Texas standard matches found for {TARGET_CCSSM_STANDARD_CODE}')
        return ccssm_standard, None

    # Sort by Jaccard score (highest first)
    texas_matches_sorted = sorted(texas_matches, key=lambda x: x['jaccard'], reverse=True)

    print(f'\n✅ Found {len(texas_matches_sorted)} Texas standard matches')
    print(f'\n📊 Top Texas match (highest Jaccard score):')

    top_match = texas_matches_sorted[0]
    print(f'  Statement Code: {top_match["statementCode"]}')
    print(f'  Jaccard Score: {top_match["jaccard"]:.4f}')
    print(f'  Shared LC Count: {top_match["sharedLCCount"]}')
    print(f'  State LC Count: {top_match["stateLCCount"]}')
    print(f'  CCSS LC Count: {top_match["ccssLCCount"]}')

    return ccssm_standard, texas_matches_sorted


"""
================================
STEP 3: INTERPRET THE RELATIONSHIP METRICS
================================
"""

def interpret_relationship_metrics(matches):
    """
    Interpret the relationship metrics for crosswalk matches

    Purpose: Each crosswalk relationship carries additional context about the degree
    of overlap:
    - sharedLCCount shows how many deconstructed skills are shared
    - stateLCCount and ccssLCCount show how many total skills support each standard
    - Together with the Jaccard score, these counts help interpret the strength and
      balance of the overlap

    Args:
        matches (list): Crosswalk matches from Step 2
    """
    if not matches:
        return

    print(f'\n📊 INTERPRETATION OF TOP MATCHES:\n')

    # Show top 5 matches with interpretation
    for idx, match in enumerate(matches[:5], 1):
        jaccard = match['jaccard']
        state_lc = match['stateLCCount']
        ccss_lc = match['ccssLCCount']
        shared_lc = match['sharedLCCount']

        print(f'Match #{idx}:')
        print(f'  Statement Code: {match["statementCode"]}')
        print(f'  Jaccard Score: {jaccard:.4f}')
        print(f'  State LC Count: {state_lc}')
        print(f'  CCSS LC Count: {ccss_lc}')
        print(f'  Shared LC Count: {shared_lc}')

        # Interpret the metrics
        if jaccard >= 0.9:
            interpretation = "Very strong overlap; standards share nearly all skills"
        elif jaccard >= 0.7:
            interpretation = "Strong overlap; substantial shared skills"
        elif jaccard >= 0.5:
            interpretation = "Moderate overlap; many shared skills"
        elif jaccard >= 0.3:
            interpretation = "Partial overlap; some shared skills"
        else:
            interpretation = "Weak overlap; few shared skills"

        # Check scope balance
        if abs(state_lc - ccss_lc) <= 2:
            scope_note = "Both standards have similar scope"
        elif state_lc > ccss_lc:
            scope_note = "State standard covers more content"
        else:
            scope_note = "CCSS standard covers more content"

        print(f'  Interpretation: {interpretation}')
        print(f'  Scope: {scope_note}')
        print()


"""
================================
STEP 4: INSPECT SHARED LEARNING COMPONENTS
================================
"""

def show_shared_learning_components(ccssm_standard, top_match):
    """
    Show shared learning components between CCSS and state standards

    Purpose: Now that you have crosswalk pairs (CCSSM → state), you can see the
    actual skills behind each match by retrieving the Learning Components that
    support each standard. We'll then identify which LCs are shared (the evidence
    behind the crosswalk) and which are unique to each standard.

    Args:
        ccssm_standard (dict): CCSSM standard from Step 2
        top_match (dict): Top Texas match from Step 2
    """
    ccssm_standard_uuid = ccssm_standard['caseIdentifierUUID']
    state_standard_uuid = top_match['caseIdentifierUUID']

    # Get LCs that support the CCSS standard
    ccss_lc_result = make_api_request(
        f'/academic-standards/{ccssm_standard_uuid}/learning-components'
    )
    ccss_lcs = ccss_lc_result['data']

    # Get LCs that support the state standard
    state_lc_result = make_api_request(
        f'/academic-standards/{state_standard_uuid}/learning-components'
    )
    state_lcs = state_lc_result['data']

    # Create sets of LC identifiers for comparison
    ccss_lc_ids = {lc['identifier'] for lc in ccss_lcs}
    state_lc_ids = {lc['identifier'] for lc in state_lcs}

    # Find shared and unique LCs
    shared_lc_ids = ccss_lc_ids & state_lc_ids
    ccss_only_ids = ccss_lc_ids - state_lc_ids
    state_only_ids = state_lc_ids - ccss_lc_ids

    # Get LC descriptions
    shared_lcs = [lc for lc in ccss_lcs if lc['identifier'] in shared_lc_ids]
    ccss_only_lcs = [lc for lc in ccss_lcs if lc['identifier'] in ccss_only_ids]
    state_only_lcs = [lc for lc in state_lcs if lc['identifier'] in state_only_ids]

    print(f'\n✅ LEARNING COMPONENTS ANALYSIS:')
    print(f'CCSS Standard: {ccssm_standard["statementCode"]}')
    print(f'State Standard: {top_match["statementCode"]}')
    print()

    print(f'📊 SHARED LEARNING COMPONENTS ({len(shared_lcs)}):')
    for idx, lc in enumerate(shared_lcs, 1):
        print(f'  ✅ {idx}. {lc["description"]}')
    print()

    print(f'📊 CCSS-ONLY LEARNING COMPONENTS ({len(ccss_only_lcs)}):')
    for idx, lc in enumerate(ccss_only_lcs, 1):
        print(f'  ➕ {idx}. {lc["description"]}')
    print()

    print(f'📊 STATE-ONLY LEARNING COMPONENTS ({len(state_only_lcs)}):')
    for idx, lc in enumerate(state_only_lcs, 1):
        print(f'  ➖ {idx}. {lc["description"]}')
    print()


"""
================================
MAIN EXECUTION
================================
"""

def main():
    """
    Main execution function - orchestrates all tutorial steps
    """
    print('\n=== USING CROSSWALKS TO COMPARE STATE STANDARDS TO COMMON CORE ===\n')

    print('🔄 Step 2: Find the best-matching state standards for a CCSSM standard...\n')
    ccssm_standard, matches = find_best_state_matches()

    if matches:
        print('\n' + '='*70)
        print('🔄 Step 3: Interpret the relationship metrics...')
        interpret_relationship_metrics(matches)

        print('='*70)
        print('🔄 Step 4: Inspect shared learning components...')
        show_shared_learning_components(ccssm_standard, matches[0])


if __name__ == '__main__':
    main()
