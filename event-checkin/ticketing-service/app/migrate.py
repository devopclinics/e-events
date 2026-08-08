import asyncio
from pathlib import Path
from sqlalchemy import text
from .database import engine


def split_statements(sql: str) -> list[str]:
    """Split SQL on semicolons while preserving PostgreSQL dollar-quoted blocks."""
    statements, buffer, dollar_tag = [], [], None
    index = 0
    while index < len(sql):
        if sql[index] == "$":
            end = sql.find("$", index + 1)
            if end != -1:
                tag = sql[index:end + 1]
                if tag == "$$" or tag[1:-1].replace("_", "a").isalnum():
                    if dollar_tag is None:
                        dollar_tag = tag
                    elif dollar_tag == tag:
                        dollar_tag = None
                    buffer.append(tag); index = end + 1; continue
        char = sql[index]
        if char == ";" and dollar_tag is None:
            statement = "".join(buffer).strip()
            if statement: statements.append(statement)
            buffer = []
        else:
            buffer.append(char)
        index += 1
    statement = "".join(buffer).strip()
    if statement: statements.append(statement)
    return statements


async def run():
    async with engine.begin() as conn:
        for path in sorted(Path("migrations").glob("*.sql")):
            for statement in split_statements(path.read_text()):
                if statement.strip():
                    await conn.execute(text(statement))


if __name__ == "__main__":
    asyncio.run(run())
