#!/usr/bin/env bash
set -e

# Grist Desktop Build Script based on official instructions

echo "🚀 Grist Desktop Build Script"

# Check if core directory exists and handle it
if [ -d "core" ]; then
    echo "⚠️ Core directory already exists. Checking if it's a proper submodule..."
    if [ ! -f "core/.git" ]; then
        echo "⚠️ Core is not a proper submodule. Backing it up and reinitializing..."
        timestamp=$(date +%Y%m%d%H%M%S)
        mv core core_backup_$timestamp
        echo "✅ Core directory backed up to core_backup_$timestamp"
    fi
fi

# Initialize and update git submodules
echo "📦 Initializing git submodules..."
git submodule init
git submodule update

# Install dependencies
echo "📦 Installing dependencies..."
yarn install

# Run setup
echo "🛠️ Running setup script..."
yarn run setup

# Build the app
echo "🏗️ Building Grist Desktop..."
yarn run build

# Create ~/.grist directory if it doesn't exist
echo "🎨 Creating custom CSS directory..."
mkdir -p ~/.grist

# Create custom CSS file
echo "🎨 Creating sample custom CSS..."
cat > ~/.grist/custom.css << EOL
/**
 * Grist Desktop Custom CSS
 */

/* Add a visible border to test custom CSS loading */
body {
  border: 5px solid red !important;
}

/* Style the header with a distinctive background */
.page_header {
  background-color: #ffcc00 !important;
}

/* Make table headers more visible */
.field_table .column_names {
  background-color: #e0f7fa !important;
  font-weight: bold !important;
}

/* Add a subtle drop shadow to cards */
.view_leaf {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1) !important;
  margin: 8px !important;
}
EOL

echo "✅ Build complete!"
echo ""
echo "To test the application:"
echo "  - Run: yarn run electron:preview"
echo "  - Or package with: yarn run electron"
echo ""
echo "Custom CSS has been created at: ~/.grist/custom.css"
echo "It should apply automatically when you open a document."