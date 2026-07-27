# docs-tools Specification

## Purpose

Read-only tools that let an agent search and fetch official ServiceNow documentation
(`ServiceNow/ServiceNowDocs`) and query curated, in-repo best-practice content, without
requiring any server-side session state.

## Requirements

### Requirement: Docs Search Tool

The system MUST expose `servicenow_docs_search`, a read-only tool that searches the
`llms.txt` index at the root of the `ServiceNow/ServiceNowDocs` repository and returns
matching topic entries (title, path, short description).

#### Scenario: Search returns matching topics

- GIVEN the `llms.txt` index is reachable
- WHEN an agent calls `servicenow_docs_search` with a query term
- THEN the tool returns a list of matching doc entries with title and path
- AND the response contains no server-side session identifiers

#### Scenario: Search finds no matches

- GIVEN the `llms.txt` index is reachable
- WHEN an agent calls `servicenow_docs_search` with a term matching no entries
- THEN the tool returns an empty result set, not an error

### Requirement: Docs Get Tool

The system MUST expose `servicenow_docs_get`, a read-only tool that fetches the full
markdown of a specific doc topic via a live HTTP request to
`https://raw.githubusercontent.com/ServiceNow/ServiceNowDocs/{branch}/...`, using the
configured release branch.

#### Scenario: Fetch a known doc topic

- GIVEN a valid doc path from a prior `servicenow_docs_search` result
- WHEN an agent calls `servicenow_docs_get` with that path
- THEN the tool returns the raw markdown content of that document
- AND the response is not cached in-process between calls

#### Scenario: Fetch an unknown doc path

- GIVEN a doc path that does not exist on the configured branch
- WHEN an agent calls `servicenow_docs_get` with that path
- THEN the tool returns a structured "not found" error, not a raw HTTP exception

### Requirement: Best Practices Tool

The system MUST expose `servicenow_best_practices`, a read-only tool that returns
curated, authored-in-repo guidance filtered by area: update-set discipline, record
operations, contracts/breaking changes, or ServiceNow coding standards.

#### Scenario: Query a specific best-practice area

- GIVEN curated content exists for the "update-set discipline" area
- WHEN an agent calls `servicenow_best_practices` with `area: "update-set-discipline"`
- THEN the tool returns that area's curated guidance content
- AND the content does not depend on network access

#### Scenario: Query without specifying an area

- WHEN an agent calls `servicenow_best_practices` with no `area` filter
- THEN the tool returns guidance for all v1 areas

### Requirement: Release Branch Configuration

The system MUST resolve the release branch used for live doc fetches from
`SN_MCP_DOCS_RELEASE`, defaulting to the `australia` branch when unset.

#### Scenario: Default release branch applies

- GIVEN `SN_MCP_DOCS_RELEASE` is unset
- WHEN `servicenow_docs_get` fetches a doc
- THEN the request targets the `australia` branch

#### Scenario: Configured release branch applies

- GIVEN `SN_MCP_DOCS_RELEASE=washingtondc`
- WHEN `servicenow_docs_get` or `servicenow_docs_search` runs
- THEN requests target the `washingtondc` branch

### Requirement: Docs Network Failure Handling

Docs tools MUST return a structured "unavailable" error when the live fetch to
`ServiceNowDocs` fails (network error, timeout, non-2xx response), and MUST NOT throw
unhandled exceptions or crash the server process.

#### Scenario: GitHub raw content is unreachable

- GIVEN `raw.githubusercontent.com` is unreachable
- WHEN an agent calls `servicenow_docs_search` or `servicenow_docs_get`
- THEN the tool returns a structured error indicating the docs source is unavailable
- AND the error does not block or affect any write-tool operation

### Requirement: License Attribution on Quoted Content

Content fetched or quoted from `ServiceNow/ServiceNowDocs` MUST retain attribution to
the source repository and its Apache License 2.0 terms; the system MUST NOT bundle or
redistribute doc content as part of the package.

#### Scenario: Quoting fetched content

- GIVEN `servicenow_docs_get` returns markdown content
- WHEN that content is surfaced to the caller
- THEN the response identifies the source repository and branch it was fetched from

### Requirement: Tool Statelessness

All docs tools MUST operate without in-process caches or sessions; each call is
independently resolved from live fetch and/or curated static content bundled at build
time.

#### Scenario: Repeated identical calls hit the network each time

- GIVEN two consecutive calls to `servicenow_docs_search` with the same query
- WHEN both calls execute
- THEN both calls independently query the `llms.txt` index (no cached result is reused)
