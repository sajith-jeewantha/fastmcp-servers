import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

from fastmcp import Client


async def main() -> None:
    server_url = os.environ.get("MCP_URL", "http://127.0.0.1:3001/mcp")
    check_in = datetime.now(timezone.utc).date() + timedelta(days=30)
    check_out = check_in + timedelta(days=2)

    async with Client(server_url) as client:
        tools = await client.list_tools()
        search = await client.call_tool(
            "search_hotels",
            {
                "city": "Seattle",
                "checkIn": check_in.isoformat(),
                "checkOut": check_out.isoformat(),
                "guests": 2,
            },
        )
        search_data = json.loads(search.content[0].text)
        print(
            json.dumps(
                {
                    "tools": [
                        {"name": tool.name, "description": tool.description}
                        for tool in tools
                    ],
                    "search": search_data,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    asyncio.run(main())
