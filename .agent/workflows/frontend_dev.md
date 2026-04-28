---
description: Frontend Development Workflow with Persistent History
---

# Frontend Development Protocol

This workflow ensures a continuous history of changes is maintained across different AI sessions.

## 1. Start of Session
- **Read History**: Always check `frontend/project_history.md` to understand the current state of the project and previous changes.
- **Append Mode**: You are contributing to this living document. Do not overwrite previous history unless correcting errors.

## 2. During Development
- **Log Changes**: As you complete tasks (Verification phase), update `frontend/project_history.md`.
- **Format**: use Markdown. Create a new Header (e.g. `## [Date] Feature Name`) for new work.
- **Details**: Include file paths modified, key architectural decisions, and verification steps (checking builds, etc.).

## 3. Committing Changes
- **Description**: Use the relevant new sections of `frontend/project_history.md` to populate the git commit description.
- **Command**:
  ```bash
  # Example
  git add .
  git commit -m "Feat: <Short Summary>" -m "<Paste relevant history here>"
  ```
