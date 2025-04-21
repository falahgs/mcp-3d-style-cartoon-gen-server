import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as util from 'util';
import * as os from 'os';
import dotenv from 'dotenv';
import { execFile } from 'child_process';
import { minimatch } from 'minimatch';

// Load environment variables
dotenv.config();

// Debug mode flag
const DEBUG = process.env.DEBUG === 'true';

// Debug logger function to avoid polluting stdout/stderr
function debugLog(...args: any[]): void {
  if (DEBUG) {
    console.error('[DEBUG]', ...args);
  }
}

// Initialize promisify for exec
const execFileAsync = util.promisify(execFile);

// Server initialization
const server = new Server({
  name: "mcp-cartoon-filesystem-server",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {}
  }
});

// Initialize Gemini AI
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable is required");
}

const genAI = new GoogleGenAI({
  apiKey: API_KEY
});

const config = {
  responseModalities: [
    'image',
    'text',
  ],
  responseMimeType: 'text/plain',
};

const model = 'gemini-2.0-flash-exp-image-generation';

// Security utilities for file system operations
function normalizePath(p: string): string {
  return path.normalize(p);
}

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

// Get allowed directories from environment or use default
const allowedDirectories = process.env.ALLOWED_DIRECTORIES
  ? process.env.ALLOWED_DIRECTORIES.split(',').map(dir => normalizePath(path.resolve(expandHome(dir))))
  : [
      normalizePath(path.resolve(os.homedir())),
      normalizePath(path.resolve(process.cwd()))
    ];

// Only log in debug mode
if (DEBUG) {
  console.error("Allowed directories:", allowedDirectories);
}

// Security validation function
async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
  if (!isAllowed) {
    throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fsPromises.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
    if (!isRealPathAllowed) {
      throw new Error("Access denied - symlink target outside allowed directories");
    }
    return realPath;
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute);
    try {
      const realParentPath = await fsPromises.realpath(parentDir);
      const normalizedParent = normalizePath(realParentPath);
      const isParentAllowed = allowedDirectories.some(dir => normalizedParent.startsWith(dir));
      if (!isParentAllowed) {
        throw new Error("Access denied - parent directory outside allowed directories");
      }
      return absolute;
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  }
}

// OS path handling functions
function getDesktopPath(): string {
  try {
    const home = os.homedir();
    const username = os.userInfo().username;
    
    // Use debug logging instead of regular console.log
    debugLog(`Detected username: ${username}`);
    debugLog(`Detected home directory: ${home}`);
    
    if (os.platform() === 'win32') {
      // Windows - User profile desktop (C:\Users\Username\Desktop)
      const desktopPath = process.env.USERPROFILE 
        ? path.join(process.env.USERPROFILE, 'Desktop')
        : path.join('C:', 'Users', username, 'Desktop');
      
      debugLog(`Windows desktop path: ${desktopPath}`);
      
      // Verify the path exists
      if (fs.existsSync(desktopPath)) {
        return desktopPath;
      } else {
        debugLog(`Desktop path not found: ${desktopPath}, falling back to home`);
        return home;
      }
    } else if (os.platform() === 'darwin') {
      // macOS
      const desktopPath = path.join(home, 'Desktop');
      debugLog(`macOS desktop path: ${desktopPath}`);
      return desktopPath;
    } else {
      // Linux - Use XDG if available
      const xdgDesktop = process.env.XDG_DESKTOP_DIR;
      if (xdgDesktop && fs.existsSync(xdgDesktop)) {
        debugLog(`Linux XDG desktop path: ${xdgDesktop}`);
        return xdgDesktop;
      }
      const linuxDesktop = path.join(home, 'Desktop');
      if (fs.existsSync(linuxDesktop)) {
        debugLog(`Linux desktop path: ${linuxDesktop}`);
        return linuxDesktop;
      }
      debugLog(`Using home directory: ${home}`);
      return home;
    }
  } catch (error) {
    console.error('Error detecting desktop path:', error);
    return os.homedir();
  }
}

function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
    } catch (error) {
      console.error(`Failed to create directory "${dirPath}":`, error);
      throw error;
    }
  }
}

async function saveImageWithProperPath(buffer: Buffer, fileName: string): Promise<{savedPath: string}> {
  try {
    // Check if SAVE_TO_DESKTOP is true
    if (process.env.SAVE_TO_DESKTOP === "true") {
      // Original desktop saving logic
      const saveDir = path.join(getDesktopPath(), 'generated-images');
      
      // Replace console.log with debugLog
      debugLog(`Saving to desktop directory: ${saveDir}`);
      debugLog(`Platform: ${os.platform()}`);
      debugLog(`Home directory: ${os.homedir()}`);
      debugLog(`Username: ${os.userInfo().username}`);
      
      // Ensure save directory exists
      ensureDirectoryExists(saveDir);
      
      // Create full path and normalize for OS
      const outputPath = path.normalize(path.join(saveDir, fileName));
      
      // Save the file
      fs.writeFileSync(outputPath, buffer);
      debugLog(`Image saved successfully to: ${outputPath}`);
      
      return { savedPath: outputPath };
    } else {
      // Save locally in the server directory
      const serverDir = process.cwd();
      const outputDir = path.join(serverDir, 'generated-images');
      
      debugLog(`Saving to server directory: ${outputDir}`);
      
      // Ensure output directory exists
      ensureDirectoryExists(outputDir);
      
      // Create full path and normalize for OS
      const outputPath = path.normalize(path.join(outputDir, fileName));
      
      // Save the file
      fs.writeFileSync(outputPath, buffer);
      debugLog(`Image saved successfully to server path: ${outputPath}`);
      
      return { savedPath: outputPath };
    }
  } catch (error) {
    console.error('Error saving image:', error);
    // Fallback to output directory
    const fallbackDir = path.join(process.cwd(), 'output');
    ensureDirectoryExists(fallbackDir);
    const fallbackPath = path.join(fallbackDir, fileName);
    fs.writeFileSync(fallbackPath, buffer);
    debugLog(`Fallback save to: ${fallbackPath}`);
    return { savedPath: fallbackPath };
  }
}

async function openInBrowser(filePath: string): Promise<void> {
  try {
    // Check for headless environment
    if (process.env.DISPLAY === undefined && os.platform() !== 'win32' && os.platform() !== 'darwin') {
      console.log('Headless environment detected, skipping browser open');
      return;
    }
    
    // Ensure path is properly formatted for the OS
    const normalizedPath = path.normalize(filePath);
    
    // Different commands for different OSes
    const command = os.platform() === 'win32' 
      ? 'explorer'
      : os.platform() === 'darwin'
        ? 'open'
        : 'xdg-open';

    const args = [normalizedPath];
    
    await execFileAsync(command, args);
    console.log(`Opened in browser: ${normalizedPath}`);
  } catch (error) {
    console.error('Error opening file in browser:', error);
    console.log('Unable to open browser automatically. File saved at:', filePath);
  }
}

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Image generation tool
      {
        name: "generate_3d_cartoon",
        description: "Generates a 3D style cartoon image for kids based on the given prompt",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The prompt describing the 3D cartoon image to generate"
            },
            fileName: {
              type: "string",
              description: "The name of the output file (without extension)"
            }
          },
          required: ["prompt", "fileName"]
        }
      },
      // File system tools
      {
        name: "read_file",
        description: "Read the contents of a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to read"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "write_file",
        description: "Write content to a file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file to write"
            },
            content: {
              type: "string",
              description: "Content to write to the file"
            }
          },
          required: ["path", "content"]
        }
      },
      {
        name: "list_directory",
        description: "List the contents of a directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the directory to list"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "create_directory",
        description: "Create a new directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the directory to create"
            }
          },
          required: ["path"]
        }
      },
      {
        name: "search_files",
        description: "Search for files matching a pattern",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Base directory to search from"
            },
            pattern: {
              type: "string",
              description: "Search pattern (glob format)"
            },
            excludePatterns: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Patterns to exclude from search (glob format)"
            }
          },
          required: ["path", "pattern"]
        }
      }
    ]
  };
});

// File system operation utilities
async function searchFiles(rootPath: string, pattern: string, excludePatterns: string[] = []): Promise<string[]> {
  const results: string[] = [];

  async function search(currentPath: string) {
    const entries = await fsPromises.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      try {
        // Validate each path before processing
        await validatePath(fullPath);

        // Check if path matches any exclude pattern
        const relativePath = path.relative(rootPath, fullPath);
        const shouldExclude = excludePatterns.some(pattern => {
          const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`;
          return minimatch(relativePath, globPattern, { dot: true });
        });

        if (shouldExclude) {
          continue;
        }

        // Check if the path matches the search pattern
        if (minimatch(entry.name, pattern, { nocase: true })) {
          results.push(fullPath);
        }

        if (entry.isDirectory()) {
          await search(fullPath);
        }
      } catch (error) {
        // Skip invalid paths during search
        continue;
      }
    }
  }

  await search(rootPath);
  return results;
}

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const toolName = request.params.name;
  const args = request.params.arguments;

  try {
    switch (toolName) {
      case "generate_3d_cartoon": {
        const { prompt, fileName } = args;
        
        // Add 3D cartoon-specific context to the prompt
        const cartoonPrompt = `Generate a 3D style cartoon image for kids: ${prompt}. The image should be colorful, playful, and child-friendly. Use bright colors, soft shapes, and a fun, engaging style that appeals to children. Make it look like a high-quality 3D animated character or scene.`;
        
        const contents = [
          {
            role: 'user',
            parts: [
              {
                text: cartoonPrompt,
              },
            ],
          },
        ];

        try {
          const response = await genAI.models.generateContentStream({
            model,
            config,
            contents,
          });

          for await (const chunk of response) {
            if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
              continue;
            }
            if (chunk.candidates[0].content.parts[0].inlineData) {
              const inlineData = chunk.candidates[0].content.parts[0].inlineData;
              const buffer = Buffer.from(inlineData.data || '', 'base64');
              
              // Create an output filename with timestamp for uniqueness
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const outputFileName = fileName.endsWith('.png') 
                ? fileName 
                : `${fileName}_${timestamp}.png`;
              
              // Find appropriate save location
              const { savedPath } = await saveImageWithProperPath(buffer, outputFileName);
              
              // Create simple HTML preview
              const htmlContent = `
              <!DOCTYPE html>
              <html>
              <head>
                <title>3D Cartoon Preview</title>
                <style>
                  body { font-family: Arial, sans-serif; margin: 20px; }
                  .image-container { max-width: 800px; margin: 0 auto; }
                  img { max-width: 100%; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                  .prompt { margin: 10px 0; color: #666; }
                  .path { font-family: monospace; margin: 10px 0; }
                </style>
              </head>
              <body>
                <h1>3D Cartoon Image</h1>
                <div class="prompt">Prompt: ${prompt}</div>
                <div class="path">Saved to: ${savedPath}</div>
                <div class="image-container">
                  <img src="file://${savedPath}" alt="Generated cartoon image">
                </div>
              </body>
              </html>
              `;

              // Create and save HTML file
              const htmlFileName = `${outputFileName.replace('.png', '')}_preview.html`;
              const htmlPath = path.join(path.dirname(savedPath), htmlFileName);
              
              // Ensure directory exists before writing
              ensureDirectoryExists(path.dirname(htmlPath));
              fs.writeFileSync(htmlPath, htmlContent, 'utf8');

              // Try to open in browser
              try {
                await openInBrowser(htmlPath);
              } catch (error) {
                console.warn('Could not open browser automatically:', error);
              }

              return {
                toolResult: {
                  success: true,
                  imagePath: savedPath,
                  htmlPath: htmlPath,
                  content: [
                    {
                      type: "text",
                      text: `Image saved to: ${savedPath}\nPreview HTML: ${htmlPath}`
                    }
                  ],
                  message: "Image generated and saved"
                }
              };
            }
          }
          
          throw new McpError(ErrorCode.InternalError, "No image data received from the API");
        } catch (error) {
          console.error('Error generating image:', error);
          if (error instanceof Error) {
            throw new McpError(ErrorCode.InternalError, `Failed to generate image: ${error.message}`);
          }
          throw new McpError(ErrorCode.InternalError, 'An unknown error occurred');
        }
      }
      
      case "read_file": {
        const validPath = await validatePath(args.path);
        const content = await fsPromises.readFile(validPath, "utf-8");
        return {
          toolResult: {
            success: true,
            content: [{ type: "text", text: content }],
            message: `File read successfully from: ${args.path}`
          }
        };
      }

      case "write_file": {
        const validPath = await validatePath(args.path);
        await fsPromises.writeFile(validPath, args.content, "utf-8");
        return {
          toolResult: {
            success: true,
            content: [{ type: "text", text: `File written successfully to: ${args.path}` }],
            message: `File saved to: ${args.path}`
          }
        };
      }

      case "list_directory": {
        const validPath = await validatePath(args.path);
        const entries = await fsPromises.readdir(validPath, { withFileTypes: true });
        const formatted = entries
          .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
          .join("\n");
        return {
          toolResult: {
            success: true,
            content: [{ type: "text", text: formatted }],
            message: `Listed directory: ${args.path}`
          }
        };
      }

      case "create_directory": {
        const validPath = await validatePath(args.path);
        await fsPromises.mkdir(validPath, { recursive: true });
        return {
          toolResult: {
            success: true,
            content: [{ type: "text", text: `Directory created: ${args.path}` }],
            message: `Created directory: ${args.path}`
          }
        };
      }

      case "search_files": {
        const validPath = await validatePath(args.path);
        const excludePatterns = args.excludePatterns || [];
        const results = await searchFiles(validPath, args.pattern, excludePatterns);
        return {
          toolResult: {
            success: true,
            content: [{ 
              type: "text", 
              text: results.length > 0 ? results.join("\n") : "No matching files found"
            }],
            message: `Found ${results.length} matching files`
          }
        };
      }

      default:
        throw new McpError(ErrorCode.InternalError, `Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`Error processing ${toolName}:`, error);
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Error processing request: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

// Only log in debug mode
if (DEBUG) {
  console.error("MCP Cartoon & Filesystem Server running");
  console.error(`Allowed directories: ${allowedDirectories.join(', ')}`);
} 