/**
 * Chat API Route - Streaming proxy to backend
 * Converts backend SSE to Vercel AI SDK compatible format
 */

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:8001';

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return new Response('No user message found', { status: 400 });
    }

    const question = lastMessage.content;

    // Call backend streaming endpoint
    const backendResponse = await fetch(`${BACKEND_URL}/pipeline/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question }),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      return new Response(`Backend error: ${errorText}`, { status: backendResponse.status });
    }

    // Create a transform stream to convert backend SSE to Vercel AI SDK format
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'text' && data.text) {
                // Stream text chunks in Vercel AI SDK format
                // Format: "0:text\n"
                controller.enqueue(encoder.encode(`0:${JSON.stringify(data.text)}\n`));
              } else if (data.type === 'sources') {
                // Send sources as data message
                // Format: "2:[data]\n"
                controller.enqueue(encoder.encode(`2:${JSON.stringify([{ sources: data.sources }])}\n`));
              } else if (data.type === 'done') {
                // Send completion metadata
                controller.enqueue(encoder.encode(`2:${JSON.stringify([{
                  confidence: data.confidence,
                  has_answer: data.has_answer,
                  search_time: data.search_time
                }])}\n`));
                // Send finish reason
                controller.enqueue(encoder.encode(`d:{"finishReason":"stop"}\n`));
              } else if (data.type === 'error') {
                controller.enqueue(encoder.encode(`3:${JSON.stringify(data.error)}\n`));
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      },
    });

    // Pipe the backend response through the transform stream
    const reader = backendResponse.body?.getReader();
    const writer = transformStream.writable.getWriter();

    if (reader) {
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
          }
        } finally {
          writer.close();
        }
      })();
    }

    return new Response(transformStream.readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
