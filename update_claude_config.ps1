$configPath = "$env:APPDATA\Claude\claude_desktop_config.json"

$config = @{
  "mcpServers" = @{
    "ElevenLabs" = @{
      "command" = "uvx"
      "args" = @("elevenlabs-mcp")
      "env" = @{
        "ELEVENLABS_API_KEY" = "sk_22a4e6759f9579229aa35e3d2aaf87fa5e8f51ae36a8200c"
      }
    }
    "mcp-3d-style-cartoon-gen-server" = @{
      "command" = "node"
      "args" = @("G:\mcp-projects\mcp-3d-style-cartoon-gen-server\build\index.js")
      "env" = @{
        "GEMINI_API_KEY" = "AIzaSyBGskNtesKEZOghmEzQRAikKdxnq75XPA4"
        "IS_REMOTE" = "true"
        # You can uncomment and customize this line to set a specific output directory
        # "OUTPUT_DIR" = "$env:USERPROFILE\Desktop\mcp-cartoons"
      }
    }
  }
}

$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath

Write-Host "Claude Desktop configuration updated successfully!" 
Write-Host "Images will be saved to the desktop or documents folder by default."
Write-Host "You can customize the save location by editing this script and uncommenting the OUTPUT_DIR line." 