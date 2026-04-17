# Generate Prerequisite Practice

Demonstrates how to generate prerequisite-based practice questions using the Knowledge Graph REST API, covering:
- **API Integration**: Using REST API to query standards and learning progressions
- **Prerequisite Analysis**: Finding standards that build towards a target standard
- **Learning Components**: Discovering granular learning components that support standards
- **Practice Generation**: Creating structured practice questions based on prerequisite knowledge using AI

> **Note:** The API is in limited early release and is only available to some private beta users. Because the API is an early release, current users should expect occasional breaking changes.

## Prerequisites

- Node.js 18 or higher (for native fetch API support)
- A Learning Commons Platform account
- An API key generated in the Learning Commons Platform
- OpenAI API key

## Dependencies

- **openai**: OpenAI API for generating practice questions
- **dotenv**: Environment variable management

## Quick Start

1. **Clone and Install**:
   ```bash
   git clone git@github.com:learning-commons-org/knowledge-graph.git
   cd tutorials/generate_prereq_practice/js
   npm install
   ```

2. **Set Environment Variables** (create `.env` file):
   ```bash
   # Knowledge Graph API credentials - get these from the Learning Commons Platform
   API_KEY=your_api_key_here
   BASE_URL=https://api.learningcommons.org/knowledge-graph/v0

   # OpenAI API key for generating practice questions
   OPENAI_API_KEY=your_openai_api_key_here
   ```

3. **Run Tutorial**:
   ```bash
   npm start
   ```
