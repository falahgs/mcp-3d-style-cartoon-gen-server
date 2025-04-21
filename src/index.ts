import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, existsSync, mkdirSync, accessSync, constants } from 'fs';
import { join, dirname, resolve, normalize, sep, basename } from 'path';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir, platform, userInfo } from 'os';

const execAsync = promisify(exec);

dotenv.config();

// Server initialization
const server = new Server({
  name: "mcp-3d-cartoon-server",
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

const ai = new GoogleGenAI({
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

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
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
    }]
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  if (request.params.name === "generate_3d_cartoon") {
    const { prompt, fileName } = request.params.arguments as { prompt: string; fileName: string };
    
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
      const response = await ai.models.generateContentStream({
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
          
          const isRemote = process.env.IS_REMOTE === 'true';
          
          // Find appropriate save location with OS detection
          const { savedPath, publicUrl } = await saveImageWithProperPath(buffer, outputFileName, isRemote);
          
          // Create preview HTML with appropriate image path
          const previewHtml = createImagePreview(savedPath, publicUrl, isRemote);

          // Create and save HTML file with same path handling
          const htmlFileName = `${outputFileName.replace('.png', '')}_preview.html`;
          const htmlPath = join(dirname(savedPath), htmlFileName);
          
          // Ensure directory exists before writing
          ensureDirectoryExists(dirname(htmlPath));
          writeFileSync(htmlPath, previewHtml, 'utf8');

          // Only try to open in browser if not in remote mode
          if (!isRemote) {
            try {
              await openInBrowser(htmlPath);
            } catch (error) {
              console.warn('Could not open browser automatically:', error);
            }
          }

          return {
            toolResult: {
              success: true,
              imagePath: savedPath,
              htmlPath: htmlPath,
              publicUrl: publicUrl || savedPath,
              content: [
                {
                  type: "text",
                  text: `Image saved to: ${savedPath}\n${isRemote ? 'Remote mode: browser preview not opened' : 'Preview opened in browser'}`
                },
                {
                  type: "html",
                  html: previewHtml
                }
              ],
              message: isRemote ? "Image generated (remote mode)" : "Image generated and preview opened in browser"
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
  
  throw new McpError(ErrorCode.InternalError, "Tool not found");
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

// Improved OS detection and path handling functions
function getDesktopPath(): string {
  const home = homedir();
  
  // Check if saveToDesktop is explicitly requested
  const saveToDesktop = process.env.SAVE_TO_DESKTOP === 'true';
  
  if (platform() === 'win32') {
    // Windows - User profile desktop
    return join(process.env.USERPROFILE || home, 'Desktop');
  } else if (platform() === 'darwin') {
    // macOS
    return join(home, 'Desktop');
  } else {
    // Linux - Use XDG if available
    return join(home, 'Desktop');
  }
}

function getDocumentsPath(): string {
  const home = homedir();
  
  if (platform() === 'win32') {
    // Windows - User profile documents
    return join(process.env.USERPROFILE || home, 'Documents');
  } else if (platform() === 'darwin') {
    // macOS
    return join(home, 'Documents');
  } else {
    // Linux - Use XDG if available or default to home
    return home;
  }
}

function getBestSavePath(): string {
  try {
    // First check for explicit settings
    if (process.env.OUTPUT_DIR) {
      const outputDir = resolve(process.env.OUTPUT_DIR);
      if (isPathWriteable(outputDir)) {
        return outputDir;
      }
    }
    
    // Check if saveToDesktop is explicitly requested
    const saveToDesktop = process.env.SAVE_TO_DESKTOP === 'true';
    if (saveToDesktop) {
      const desktopPath = getDesktopPath();
      const targetDir = join(desktopPath, 'mcp-3d-cartoons');
      ensureDirectoryExists(targetDir);
      return targetDir;
    }
    
    // Try desktop first
    const desktopPath = join(getDesktopPath(), 'mcp-3d-cartoons');
    if (isPathWriteable(dirname(desktopPath))) {
      ensureDirectoryExists(desktopPath);
      return desktopPath;
    }
    
    // Then documents
    const docsPath = join(getDocumentsPath(), 'mcp-3d-cartoons');
    if (isPathWriteable(dirname(docsPath))) {
      ensureDirectoryExists(docsPath);
      return docsPath;
    }
    
    // Finally fallback to home directory
    const homePath = join(homedir(), 'mcp-3d-cartoons');
    ensureDirectoryExists(homePath);
    return homePath;
  } catch (error) {
    console.warn('Error finding best save path, falling back to output directory in CWD:', error);
    const fallbackPath = join(process.cwd(), 'output');
    ensureDirectoryExists(fallbackPath);
    return fallbackPath;
  }
}

function isPathWriteable(path: string): boolean {
  try {
    if (!existsSync(path)) {
      // If path doesn't exist, try to make it
      try {
        ensureDirectoryExists(path);
        return true;
      } catch (e) {
        return false;
      }
    }
    
    // Test write access
    accessSync(path, constants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function ensureDirectoryExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch (error) {
      console.error(`Failed to create directory "${dirPath}":`, error);
      throw error;
    }
  }
}

async function saveImageWithProperPath(buffer: Buffer, fileName: string, isRemote: boolean = false): Promise<{savedPath: string, publicUrl?: string}> {
  try {
    // Get best save path based on OS and permissions
    const saveDir = getBestSavePath();
    
    // Log for debugging
    console.log(`Saving to directory: ${saveDir}`);
    console.log(`Platform: ${platform()}`);
    console.log(`Home directory: ${homedir()}`);
    
    // Ensure save directory exists
    ensureDirectoryExists(saveDir);
    
    // Create full path and normalize for OS
    const outputPath = normalize(join(saveDir, fileName));
    
    // Save the file
    writeFileSync(outputPath, buffer);
    console.log(`Image saved successfully to: ${outputPath}`);
    
    // For remote mode, create a publicUrl
    let publicUrl = undefined;
    if (isRemote) {
      // In remote mode, the path needs to be accessible to the client
      // This could be a relative path or a full URL depending on your setup
      publicUrl = `/output/${fileName}`;
      console.log(`Public URL for remote access: ${publicUrl}`);
    }
    
    return { savedPath: outputPath, publicUrl };
  } catch (error) {
    console.error('Error saving image:', error);
    // Fallback to output directory
    const fallbackDir = join(process.cwd(), 'output');
    ensureDirectoryExists(fallbackDir);
    const fallbackPath = join(fallbackDir, fileName);
    writeFileSync(fallbackPath, buffer);
    console.log(`Fallback save to: ${fallbackPath}`);
    return { savedPath: fallbackPath };
  }
}

function createImagePreview(imagePath: string, publicUrl?: string, isRemote: boolean = false): string {
  // Normalize paths for consistent URL handling
  let normalizedPath = normalize(imagePath).replace(/\\/g, '/');
  
  // For remote mode, use publicUrl if available, otherwise local file
  const imageUrl = isRemote && publicUrl
    ? publicUrl 
    : `file://${normalizedPath}`;
  
  const downloadButton = isRemote 
    ? `<div style="margin-top: 15px; text-align: center;">
         <a href="${imageUrl}" download="${basename(normalizedPath)}" 
            style="display: inline-block; background: #4CAF50; color: white; 
                   padding: 10px 20px; text-decoration: none; border-radius: 4px; 
                   font-weight: bold;">
           Download Image
         </a>
       </div>`
    : '';

  const osInfo = `
    <div style="margin-top: 10px; font-size: 12px; color: #666;">
      <p>OS: ${platform()}</p>
      <p>Save directory: ${dirname(normalizedPath)}</p>
    </div>
  `;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Cartoon Image</title>
</head>
<body style="font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 800px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
    <div style="padding: 20px; background: #f0f9ff; border-bottom: 1px solid #e0e0e0;">
      <h1 style="margin: 0; color: #333; font-size: 24px;">3D Cartoon Image</h1>
      <p style="margin: 5px 0 0; color: #666;">Saved to: ${normalizedPath}</p>
    </div>
    <div style="padding: 20px;">
      <div style="border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <img src="${imageUrl}" alt="Generated image" style="width: 100%; height: auto; display: block;">
      </div>
      ${downloadButton}
      ${osInfo}
    </div>
  </div>
</body>
</html>
`;
}

async function openInBrowser(filePath: string): Promise<void> {
  try {
    // Check for headless environment
    if (process.env.DISPLAY === undefined && platform() !== 'win32' && platform() !== 'darwin') {
      console.log('Headless environment detected, skipping browser open');
      return;
    }
    
    // Ensure path is properly formatted for the OS
    const normalizedPath = normalize(filePath);
    
    // Different commands for different OSes
    const command = platform() === 'win32' 
      ? `start "" "${normalizedPath}"`
      : platform() === 'darwin'
        ? `open "${normalizedPath}"`
        : `xdg-open "${normalizedPath}"`;
    
    await execAsync(command);
    console.log(`Opened in browser: ${normalizedPath}`);
  } catch (error) {
    console.error('Error opening file in browser:', error);
    console.log('Unable to open browser automatically. File saved at:', filePath);
  }
} 