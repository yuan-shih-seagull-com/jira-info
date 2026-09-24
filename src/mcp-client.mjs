function matchingTool(tools, operationName) {
  return tools.find(({ name }) =>
    name === operationName ||
    name.endsWith(`_${operationName}`) ||
    name.endsWith(`.${operationName}`)
  );
}

function decodeResult(result) {
  const text = result?.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");

  if (result?.isError) {
    throw new Error(text || "The MCP server returned an error.");
  }

  if (result?.structuredContent !== undefined) {
    return unwrapResult(result.structuredContent);
  }
  if (text) {
    try {
      return unwrapResult(JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`The MCP server returned non-JSON output: ${text}`);
      }
      throw error;
    }
  }
  return unwrapResult(result);
}

function unwrapResult(value) {
  let result = value;
  while (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.hasOwn(result, "data") &&
    (Object.keys(result).length === 1 || Object.hasOwn(result, "message"))
  ) {
    result = result.data;
  }
  return result;
}

export async function createOperationCaller(client) {
  const listedTools = await client.listTools();
  const tools = listedTools.tools ?? [];
  const executeRead = matchingTool(tools, "executeRead");

  return async function callOperation(operationName, cloudId, inputs = {}) {
    const directTool = matchingTool(tools, operationName);
    if (directTool) {
      const args = { ...inputs };
      if (cloudId && operationName !== "getAccessibleAtlassianResources" && operationName !== "atlassianUserInfo") {
        args.cloudId ??= cloudId;
      }
      return decodeResult(await client.callTool({ name: directTool.name, arguments: args }));
    }

    if (!executeRead) {
      throw new Error(`The MCP server does not expose ${operationName} or the executeRead tool.`);
    }
    const args = { name: operationName, inputs };
    if (cloudId) {
      args.cloudId = cloudId;
    }
    return decodeResult(await client.callTool({ name: executeRead.name, arguments: args }));
  };
}