# Fix Claude Desktop configuration file
# This script creates a properly formatted JSON configuration file for Claude Desktop

# Define the configuration content as a PowerShell object
$config = @{
    mcpServers = @{
        "mcp-3d-cartoon-generator" = @{
            command = "node"
            args = @(
                "G:\mcp-projects\mcp-3d-style-cartoon-gen-server\build\index.js"
            )
            env = @{
                "GEMINI_API_KEY" = "AIzaSyBGskNtesKEZOghmEzQRAikKdxnq75XPA4"
                "IS_REMOTE" = "true"
                "SAVE_TO_DESKTOP" = "true"
                "DETECT_OS_PATHS" = "true"
                "ALLOWED_DIRECTORIES" = "$env:USERPROFILE\Desktop,$env:USERPROFILE\Documents"
                "DEBUG" = "false"
            }
        }
    }
}

# Ensure directory exists
$configDir = "$env:APPDATA\Claude"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

# Path to configuration file
$configFile = "$configDir\claude_desktop_config.json"

# Convert to JSON and write to file
$jsonContent = ConvertTo-Json -InputObject $config -Depth 10
Set-Content -Path $configFile -Value $jsonContent -Encoding UTF8

# Display the content to verify it was written correctly
Write-Host "Claude Desktop configuration file has been fixed!"
Write-Host "Saved to: $configFile"
Write-Host "Server includes both 3D cartoon generation and file system tools"
Write-Host ""
Write-Host "Configuration content:"
Get-Content $configFile 