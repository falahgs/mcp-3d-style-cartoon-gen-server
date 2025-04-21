# MCP 3D Cartoon Generator

[![smithery badge](https://smithery.ai/badge/@falahgs/mcp-3d-style-cartoon-gen-server)](https://smithery.ai/server/@falahgs/mcp-3d-style-cartoon-gen-server)
A professional-grade server for generating high-quality 3D-style cartoon images using Google's Gemini AI. This tool specializes in creating child-friendly, colorful, and engaging cartoon images from text prompts.

![3D Cartoon Generator Demo](./video/mcp-3d-style-server.gif)

## 🌟 Features

- **3D Cartoon Generation**: Creates high-quality 3D-style cartoon images
- **Child-Friendly Design**: Focuses on colorful, playful, and engaging visuals
- **Instant Preview**: Automatically opens generated images in your default browser
- **Local Storage**: Saves images and previews in an organized output directory
- **Professional Configuration**: Robust error handling and logging
- **Cross-Platform Support**: Intelligent file path handling for Windows, macOS, and Linux
- **Smart OS Detection**: Automatically finds the best save location for each operating system

## 🛠️ Technical Stack

- **Core Framework**: Model Context Protocol (MCP) SDK
- **AI Integration**: Google Generative AI (Gemini Pro Vision)
- **Runtime**: Node.js v14+
- **Language**: TypeScript
- **Package Manager**: npm

## 📋 Prerequisites

- Node.js (v14 or higher)
- Google Gemini API key
- TypeScript

## ⚙️ Installation

### Installing via Smithery

To install 3D Cartoon Generator Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@falahgs/mcp-3d-style-cartoon-gen-server):

```bash
npx -y @smithery/cli install @falahgs/mcp-3d-style-cartoon-gen-server --client claude
```

### Manual Installation
1. Clone the repository:
```bash
git clone https://github.com/falahgs/mcp_3d_cartoon_generator.git
cd mcp_3d_cartoon_generator
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY=your_api_key_here
```

## 🔧 Configuring Claude Desktop with MCP Server

To integrate the MCP 3D Cartoon Generator with Claude Desktop:

1. Locate the Configuration File:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. Edit the Configuration:
   Open the `claude_desktop_config.json` file in a text editor and add the following configuration:

```json
{
  "mcpServers": {
    "mcp-3d-style-cartoon-gen-server": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "@smithery/cli@latest",
        "run",
        "@falahgs/mcp-3d-style-cartoon-gen-server",
        "--config",
        "{\"geminiApiKey\":\"your_gemini_api_key_here\", \"crossPlatformPaths\": true, \"saveToDesktop\": true}"
      ],
      "env": {
        "IS_REMOTE": "true",
        "DETECT_OS_PATHS": "true"
      }
    }
  }
}
```

This configuration uses Smithery to automatically handle cross-platform path issues, ensuring that image files are saved in the appropriate location for your operating system.

## 🚀 Usage

### Tool Configuration

The server provides a single tool for 3D cartoon image generation:

```typescript
{
  "name": "generate_3d_cartoon",
  "description": "Generates a 3D style cartoon image for kids based on the given prompt",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "The prompt describing the 3D cartoon image to generate"
      },
      "fileName": {
        "type": "string",
        "description": "The name of the output file (without extension)"
      }
    },
    "required": ["prompt", "fileName"]
  }
}
```

### Example Usage

1. Generate an image:
```typescript
{
  "name": "generate_3d_cartoon",
  "arguments": {
    "prompt": "A friendly robot playing with a cat",
    "fileName": "robot_cat_play"
  }
}
```

2. The tool will:
   - Generate the image using Gemini AI
   - Save it as a PNG file in the `output` directory
   - Create an HTML preview
   - Open the preview in your default browser (in local mode)
   - Return both the image path and preview

### Local vs. Remote Mode

The server can operate in two modes:

#### Local Mode
- Default when running directly from the command line
- Automatically opens generated images in your default browser
- Uses `file://` protocol to display images in HTML preview

#### Remote Mode 
- Activated by setting `IS_REMOTE=true` environment variable
- Doesn't attempt to open browser (useful for headless environments)
- Creates download links in the HTML preview
- Designed for Claude Desktop integration

To enable remote mode, set the environment variable in your Claude Desktop config:
```json
"env": {
  "GEMINI_API_KEY": "your_key_here",
  "IS_REMOTE": "true"
}
```

### Cross-Platform Path Handling

The server supports two methods for handling file paths across different operating systems:

#### 1. Using Smithery Package (Recommended)
When using the MCP server through Claude Desktop, the Smithery package provides automatic OS detection and path handling:

- **Windows**: Saves to User's Desktop folder by default
- **macOS**: Uses Desktop folder in the user's home directory
- **Linux**: Saves to a folder in the user's home directory

Key configuration options:
- `crossPlatformPaths`: Enables automatic path normalization 
- `saveToDesktop`: Ensures files are saved to the desktop on all platforms
- `DETECT_OS_PATHS`: Environment variable that activates OS-specific path detection

#### 2. Direct Node.js Usage (Advanced)
When running the server directly via Node.js, it implements custom path handling logic:

- **Windows**: Tries Desktop first (USERPROFILE\Desktop), then Documents (USERPROFILE\Documents)
- **macOS**: Uses Desktop in HOME directory, falls back to Documents
- **Linux**: Tries Desktop, falls back to user's HOME directory
- **Fallback**: Uses current working directory's "output" folder if all else fails

For direct usage, environment variables provide additional control:
- `OUTPUT_DIR`: Specify exact save location (used first if set and writable)
- `SAVE_TO_DESKTOP`: Force saving to Desktop folder across all OS platforms 

Additional features:
- **Write permission checking**: Tests if directories are actually writable
- **Automatic directory creation**: Creates folders if they don't exist
- **Robust error handling**: Falls back gracefully if primary save locations fail
- **Path normalization**: Properly handles backslashes and forward slashes by OS
- **Diagnostic logging**: Shows detected OS and save paths for troubleshooting

### Example Prompts

- "A group of happy animals having a picnic in a magical forest"
- "A young astronaut exploring a colorful alien planet"
- "A magical fairy teaching baby dragons to fly"
- "A friendly robot helping children build a treehouse"

## 📁 Output Structure

```
output/
├── image_name.png          # Generated image
└── image_name_preview.html # HTML preview
```

## 🔒 Security Notes

- Keep your API keys secure and never commit them to version control
- Use environment variables for sensitive configuration
- Run the server in a secure environment

## 📄 License

[Your chosen license]

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 