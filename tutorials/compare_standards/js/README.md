# Compare Standards

Demonstrates how to use crosswalk data to compare standards between the Common Core State Standards (CCSSM) and state frameworks using the Knowledge Graph REST API, covering:
- **API Integration**: Using REST API to query crosswalk data
- **Standards Comparison**: Finding state standards that align with CCSS standards
- **Jaccard Scoring**: Understanding alignment strength using Jaccard scores
- **Learning Components**: Analyzing shared and unique learning components

> **Note:** The API is in limited early release and is only available to some private beta users. Because the API is an early release, current users should expect occasional breaking changes.

## Prerequisites

- Node.js 18 or higher (for native fetch API support)
- A Learning Commons Platform account
- An API key generated in the Learning Commons Platform

## Dependencies

- **dotenv**: Environment variable management

## Quick Start

1. **Clone and Install**:
   ```bash
   git clone git@github.com:learning-commons-org/knowledge-graph.git
   cd tutorials/compare_standards/js
   npm install
   ```

2. **Set Environment Variables** (create `.env` file):
   ```bash
   # Knowledge Graph API credentials - get these from the Learning Commons Platform
   API_KEY=your_api_key_here
   BASE_URL=https://api.learningcommons.org/knowledge-graph/v0
   ```

3. **Run Tutorial**:
   ```bash
   npm start
   ```
