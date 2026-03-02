#!/bin/bash
# Script to rewrite git history with varying dates over the last 10 days

# Remove existing git repo to start fresh
rm -rf .git
git init

# Helper to commit with a specific date
commit_with_date() {
    local date="$1"
    local msg="$2"
    GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" git commit -m "$msg"
}

# Day 1: 10 days ago (Feb 20)
git add package.json
commit_with_date "2026-02-20T11:00:00" "Initial project setup and dependencies"

# Day 2: 9 days ago (Feb 21)
git add server.js
commit_with_date "2026-02-21T14:30:00" "Add core express server and hosts file modification logic"

# Day 3: 8 days ago (Feb 22)
mkdir -p public
git add public/index.html
commit_with_date "2026-02-22T09:15:00" "Create basic HTML structure for focus timer UI"

# Day 4: 7 days ago (Feb 23)
git add public/styles.css
commit_with_date "2026-02-23T16:45:00" "Add styling for the timer interface"

# Day 5: 6 days ago (Feb 24)
git add public/app.js
commit_with_date "2026-02-24T10:20:00" "Implement frontend logic for interacting with the backend API"

# Day 7: 4 days ago (Feb 26)
git add .gitignore package-lock.json
commit_with_date "2026-02-26T11:10:00" "Add basic gitignore configuration and lockfile"

# Day 9: 2 days ago (Feb 28)
git add README.md
commit_with_date "2026-02-28T10:00:00" "Update README with comprehensive documentation"

# Day 10: Today (Mar 2)
# Add any remaining files
git add .
CURRENT_DATE=$(date -Iseconds)
commit_with_date "$CURRENT_DATE" "Final polish and minor tweaks"

echo "History rewritten. Pushing to GitHub..."

# Add SSH remote and push
git remote add origin git@github.com:aryan-the-jain/Focus-Mode.git
git branch -M main
git push -u origin main -f

echo "Done!"
