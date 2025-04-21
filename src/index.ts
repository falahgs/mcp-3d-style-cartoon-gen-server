import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

dotenv.config();

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
server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
          
          // Save the image with cross-platform path handling
          const { savedPath, publicUrl } = await saveImageToAppropriateLocation(buffer, outputFileName, isRemote);
          
          // Create preview HTML with appropriate image path
          const previewHtml = createImagePreview(savedPath, publicUrl, isRemote);

          // Create and save HTML file
          const htmlFileName = `${outputFileName.replace('.png', '')}_preview.html`;
          const outputDir = getOutputDirectory();
          const htmlPath = join(outputDir, htmlFileName);
          
          // Ensure directory exists before writing
          ensureDirectoryExists(outputDir);
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

// Updated utility functions with cross-platform support
function getOutputDirectory(): string {
  // Get the appropriate output directory based on OS
  // First check if output dir is specified in env
  if (process.env.OUTPUT_DIR) {
    return process.env.OUTPUT_DIR;
  }
  
  // Default to OS-specific common locations
  if (process.platform === 'win32') {
    // Windows: Use Desktop or Documents
    const desktopPath = join(process.env.USERPROFILE || '', 'Desktop', 'mcp-3d-cartoons');
    if (isDirectoryWriteable(desktopPath)) {
      return desktopPath;
    }
    const documentsPath = join(process.env.USERPROFILE || '', 'Documents', 'mcp-3d-cartoons');
    if (isDirectoryWriteable(documentsPath)) {
      return documentsPath;
    }
  } else if (process.platform === 'darwin') {
    // macOS
    const desktopPath = join(process.env.HOME || '', 'Desktop', 'mcp-3d-cartoons');
    if (isDirectoryWriteable(desktopPath)) {
      return desktopPath;
    }
    const documentsPath = join(process.env.HOME || '', 'Documents', 'mcp-3d-cartoons');
    if (isDirectoryWriteable(documentsPath)) {
      return documentsPath;
    }
  } else {
    // Linux/Unix
    const homePath = join(process.env.HOME || '', 'mcp-3d-cartoons');
    if (isDirectoryWriteable(homePath)) {
      return homePath;
    }
  }
  
  // Fallback to current working directory/output
  return join(process.cwd(), 'output');
}

function isDirectoryWriteable(dirPath: string): boolean {
  try {
    // If directory doesn't exist yet, check parent
    if (!existsSync(dirPath)) {
      const parentDir = dirPath.split('/').slice(0, -1).join('/');
      if (!existsSync(parentDir)) {
        return false;
      }
      
      // Try to create the directory
      mkdirSync(dirPath, { recursive: true });
      return true;
    }
    
    // Test write access by creating a temporary file
    const testFile = join(dirPath, `.write-test-${Date.now()}`);
    writeFileSync(testFile, '');
    
    // Clean up
    try {
      import('fs').then(fs => fs.unlinkSync(testFile));
    } catch (e) {
      // Ignore cleanup errors
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

function ensureDirectoryExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

async function saveImageToAppropriateLocation(buffer: Buffer, fileName: string, isRemote: boolean = false): Promise<{savedPath: string, publicUrl?: string}> {
  // Get the output directory based on OS and writability
  const outputDir = getOutputDirectory();
  
  // Ensure the directory exists
  ensureDirectoryExists(outputDir);
  
  // Save the image file with normalized path
  const outputPath = join(outputDir, fileName);
  writeFileSync(outputPath, buffer);
  
  // For remote mode, we could return a public URL if available
  let publicUrl = undefined;
  
  if (isRemote) {
    // Normalize the path for URL use
    const normalizedPath = outputPath.replace(/\\/g, '/');
    publicUrl = `/output/${fileName}`;
    
    // Log for debugging
    console.log(`Image saved to ${outputPath}`);
    console.log(`Public URL: ${publicUrl}`);
  }
  
  return { savedPath: outputPath, publicUrl };
}

function createImagePreview(imagePath: string, publicUrl?: string, isRemote: boolean = false): string {
  // Normalize paths for consistent file:// URLs
  let normalizedPath = imagePath.replace(/\\/g, '/');
  
  // For remote mode, use the publicUrl if available
  // For local mode, use the file:// protocol with proper OS path handling
  const imageUrl = isRemote && publicUrl
    ? publicUrl
    : `file://${normalizedPath}`;

  // Add download button for remote usage
  const downloadButton = isRemote 
    ? `<div style="margin-top: 15px; text-align: center;">
         <a href="${imageUrl}" download="${normalizedPath.split('/').pop()}" 
            style="display: inline-block; background: #4CAF50; color: white; 
                   padding: 10px 20px; text-decoration: none; border-radius: 4px; 
                   font-weight: bold;">
           Download Image
         </a>
       </div>`
    : '';

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
    </div>
  </div>
</body>
</html>
`;
}

async function openInBrowser(filePath: string): Promise<void> {
  try {
    // Check for headless environment
    if (process.env.DISPLAY === undefined && process.platform !== 'win32' && process.platform !== 'darwin') {
      console.log('Headless environment detected, skipping browser open');
      return;
    }
    
    // Normalize the path for the current OS
    const normalizedPath = filePath.replace(/\//g, process.platform === 'win32' ? '\\' : '/');
    
    const command = process.platform === 'win32' 
      ? `start "" "${normalizedPath}"`
      : process.platform === 'darwin'
        ? `open "${normalizedPath}"`
        : `xdg-open "${normalizedPath}"`;
    
    await execAsync(command);
  } catch (error) {
    console.error('Error opening file in browser:', error);
    // Don't throw - just log the error and continue
    console.log('Unable to open browser automatically. File saved at:', filePath);
  }
} 