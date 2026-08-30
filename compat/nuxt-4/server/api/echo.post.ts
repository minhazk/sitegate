export default defineEventHandler(async (event) => {
  setResponseStatus(event, 207);
  setResponseHeader(event, "X-Echo", "1");
  return (await readRawBody(event)) ?? "";
});
