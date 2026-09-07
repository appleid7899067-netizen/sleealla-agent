package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type DuckDuckGoTool struct {
	clientSession *mcp.ClientSession
	mcpTool       *mcp.Tool
	args          map[string]any
}

func (t *DuckDuckGoTool) Name() string { return t.mcpTool.Name }
func (t *DuckDuckGoTool) Description() string { return t.mcpTool.Description }

func (t *DuckDuckGoTool) Call(ctx context.Context, input string) (string, error) {
	switch t.mcpTool.Name {
	case "fetch_content":
		t.args["url"] = input
	case "search":
		t.args["query"] = input
	default:
		return "", fmt.Errorf("unsupported tool: %s", t.mcpTool.Name)
	}

	res, err := t.clientSession.CallTool(ctx, &mcp.CallToolParams{
		Name: t.mcpTool.Name, Arguments: t.args,
	})
	if err != nil { return "", err }

	str := ""
	for _, content := range res.Content {
		bs, err := content.MarshalJSON()
		if err != nil { return "", fmt.Errorf("marshal json content: %w", err) }
		var r response
		if err := json.Unmarshal(bs, &r); err != nil {
			return "", fmt.Errorf("unmarshal json content: %w", err)
		}
		if r.Type != "text" {
			return "", fmt.Errorf("unsupported response type (yet): %s", r.Type)
		}
		str += content.(*mcp.TextContent).Text
	}
	return str, nil
}

type response struct { Type string `json:"type"` }
