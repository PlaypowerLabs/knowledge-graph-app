Demonstrates how to work with state educational standards data using the Knowledge Graph REST API, covering:
- **API Integration**: Using REST API to query standards frameworks and items
- **Standards Querying**: Filtering standards by jurisdiction, grade level, and type

> **Note:** The API is in limited early release and is only available to some private beta users. Because the API is an early release, current users should expect occasional breaking changes.

## Prerequisites

- Python 3.8 or higher
- A Learning Commons Platform account
- An API key generated in the Learning Commons Platform

## Dependencies

- **requests**: HTTP library for API calls
- **python-dotenv**: Environment variable management

## Quick Start

1. **Clone and Set Up Virtual Environment**:
   ```bash
   git clone git@github.com:learning-commons-org/knowledge-graph.git
   cd tutorials/working_with_standards/python
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Set Environment Variables** (create `.env` file):
   ```bash
   # Knowledge Graph API credentials - get these from the Learning Commons Platform
   API_KEY=your_api_key_here
   BASE_URL=https://api.learningcommons.org/knowledge-graph/v0
   ```

3. **Run Tutorial**:
   ```bash
   python work_with_state_standards.py
   ```
