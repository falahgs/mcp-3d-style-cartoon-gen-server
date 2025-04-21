$config = @'
{
  "mcpServers": {
    "mcp-3d-cartoon-generator": {
      "command": "node",
      "args": [
        "G:\\mcp-projects\\mcp-3d-style-cartoon-gen-server\\build\\index.js"
      ],
      "env": {
        "GEMINI_API_KEY": "AIzaSyBGskNtesKEZOghmEzQRAikKdxnq75XPA4",
        "IS_REMOTE": "true",
        "SAVE_TO_DESKTOP": "true",
        "DETECT_OS_PATHS": "true",
        "ALLOWED_DIRECTORIES": "C:\\Users\\Max\\Desktop,C:\\Users\\Max\\Documents",
        "DEBUG": "false"
      }
    }
  }
}
'@

$configPath = "$env:APPDATA\Claude\claude_desktop_config.json"

# Make sure the directory exists
$configDir = Split-Path -Path $configPath -Parent
if (-not (Test-Path -Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

# Write the file with UTF-8 encoding without BOM
[System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

Write-Host "Claude Desktop configuration file has been fixed."
Write-Host "Configuration saved to: $configPath"
Write-Host "Server includes both 3D cartoon generation and file system tools."
Write-Host "Debug logging disabled to prevent JSON parsing errors." 