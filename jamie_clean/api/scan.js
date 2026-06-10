export default async function handler(req, res) {
  // CORS headers so the browser can call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64 || !mimeType) {
      return res.status(400).json({ error: 'imageBase64 and mimeType are required' });
    }

    if (imageBase64.length > 1_500_000) {
      return res.status(413).json({ error: 'Image too large' });
    }

    const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
    if (!CLAUDE_KEY) {
      return res.status(500).json({ error: 'Claude API key not configured' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `Extract from this Gino's pizza delivery slip. Respond ONLY with raw JSON, no markdown, no backticks.

Fields:
- orderNumber: the Order # (string)
- customerName: customer name at the TOP of the Customer Details section (string, e.g. "VAN WYK")
- address: for normal Stellenbosch deliveries, return ONLY the street number + street name. Fix misspellings using your knowledge of Stellenbosch, Western Cape, South Africa street names. If the address mentions Longlands, normalize it to just "Longlands, Stellenbosch". Make it Google Maps ready.
- phone: if multiple phone numbers listed, use the LAST (bottom-most) number (string)
- deliveryFee: the DELIVERY FEE line value as a number (0 if not found)
- totalBill: the Subtotal amount the customer owes (number, look for "Subtotal" or "Total" line, 0 if not found)
- items: array of food/pizza names only (exclude DELIVERY, BTL lines)

If any field is unclear write "unknown".`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('Claude API error:', response.status, errData);
      return res.status(response.status).json({
        error: errData.error?.message || `Claude API returned ${response.status}`
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('JSON parse failed:', clean);
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: clean });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Scan proxy error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
