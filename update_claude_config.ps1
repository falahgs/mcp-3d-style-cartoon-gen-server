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
      }
    }
  }
}

$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath

Write-Host "Claude Desktop configuration updated successfully!" 