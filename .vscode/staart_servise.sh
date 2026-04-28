#!/bin/bash
# Define absolute paths based on user request
# Assuming /Downloads is relative to the user's home directory.
# If your Downloads folder is actually at the root level (/Downloads), remove the $HOME prefix.
BACKEND_DIR="$HOME/Downloads/clinic_related/Backend_db"
FRONTEND_DIR="$HOME/Downloads/clinic_related/frontend"
# Check if gnome-terminal is available
if command -v gnome-terminal &> /dev/null; then
    # Open Backend Terminal
    gnome-terminal --tab --working-directory="$BACKEND_DIR" --title="Backend Server" -- bash -c "echo 'Starting Backend...'; source ./venv/bin/activate && python3 ./app.py; exec bash"
    # Open Frontend Terminal
    gnome-terminal --tab --working-directory="$FRONTEND_DIR" --title="Frontend Server" -- bash -c "echo 'Starting Frontend...'; npm install && npm run dev; exec bash"
    
    echo "Terminals launched using gnome-terminal."
else
    # Fallback for other terminals (e.g., xterm) or basic execution
    echo "gnome-terminal found. Trying xterm..."
    
    if command -v xterm &> /dev/null; then
        xterm -title "Backend" -e "cd \"$BACKEND_DIR\" && source ./venv/bin/activate && python3 ./app.py; bash" &
        xterm -title "Frontend" -e "cd \"$FRONTEND_DIR\" && npm install && npm run dev; bash" &
        echo "Terminals launched using xterm."
    else
        echo "Error: neither gnome-terminal nor xterm found. Please run this script in a graphical environment or install a terminal emulator."
    fi
fi
