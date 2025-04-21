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
          
          // Save the image
          const outputFileName = fileName.endsWith('.png') ? fileName : `${fileName}.png`;
          const isRemote = process.env.IS_REMOTE === 'true';
          const { savedPath, publicUrl } = await saveImageBuffer(buffer, outputFileName, isRemote);
          
          // Create preview HTML with appropriate image path
          const previewHtml = createImagePreview(savedPath, publicUrl, isRemote);

          // Create and save HTML file
          const htmlFileName = `${fileName}_preview.html`;
          const htmlPath = join(process.cwd(), 'output', htmlFileName);
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

// Updated utility functions
async function saveImageBuffer(buffer: Buffer, fileName: string, isRemote: boolean = false): Promise<{savedPath: string, publicUrl?: string}> {
  // Ensure output directory exists
  const outputDir = join(process.cwd(), 'output');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  
  // Save the image file
  const outputPath = join(outputDir, fileName);
  writeFileSync(outputPath, buffer);
  
  // For remote mode, we could return a public URL if available
  // This is a placeholder - in a real implementation you might upload to S3/etc
  const publicUrl = isRemote ? `/output/${fileName}` : undefined;
  
  return { savedPath: outputPath, publicUrl };
}

function createImagePreview(imagePath: string, publicUrl?: string, isRemote: boolean = false): string {
  // For remote mode, use the publicUrl if available
  // For local mode, use the file:// protocol
  const imageUrl = isRemote && publicUrl 
    ? publicUrl 
    : `file://${imagePath}`;

  // Add download button for remote usage
  const downloadButton = isRemote 
    ? `<div style="margin-top: 15px; text-align: center;">
         <a href="${imageUrl}" download="${imagePath.split('/').pop()}" 
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
    
    const command = process.platform === 'win32' 
      ? `start "" "${filePath}"`
      : process.platform === 'darwin'
        ? `open "${filePath}"`
        : `xdg-open "${filePath}"`;
    
    await execAsync(command);
  } catch (error) {
    console.error('Error opening file in browser:', error);
    // Don't throw - just log the error and continue
    console.log('Unable to open browser automatically. File saved at:', filePath);
  }
} 