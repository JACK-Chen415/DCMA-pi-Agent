# 嵌入服务接入

知识库支持 OpenAI 兼容的 `POST /v1/embeddings` 接口。聊天模型继续负责回答，嵌入模型负责将资料和查询转换为向量。

在 `packages/web/.env` 配置 `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`。服务地址应以 `/v1` 结尾。具体地址和密钥通过私密渠道提供，不写入代码或本文档。

本次使用 Qwen3-Embedding-8B 的 Ollama `qwen3-embedding:8b`（Q4_K_M 量化版），输出 4096 维。服务只开放带 Bearer 密钥的嵌入接口和模型列表，不提供 SSH 或模型管理权限。

配置 `EMBEDDING_INDEX_PATH=../../.dcma-runtime/knowledge/vectors.json` 将索引存入 Git 忽略目录。相对路径以 `packages/web/knowledge/data` 为基准，也支持绝对路径。索引包含服务地址，因此使用私有服务时必须设置此路径。

在项目根目录执行：

```sh
npm run knowledge:reindex --workspace=packages/web
npm run web:dev
```

首次接入、更换模型或更新资料后重新构建索引。不要混用不同模型生成的向量。索引就绪后，`GET /api/knowledge/health` 应显示 `retrieval: hybrid`、`vectors.ready: true`。自然语言知识检索组合关键词与向量相似度；故障码精确查询仍跳过嵌入请求。

服务繁忙返回 429；无效密钥返回 401；不支持的模型返回 400；聊天接口返回 404。网络需要能访问服务所在内网，密钥只用于后端。HTTP 部署没有 TLS 加密，应限制在可信网络内；公网部署前需要 HTTPS。

本机私密交接文件位于 `.dcma-runtime/private/Embedding同学接入说明.md`，包含完整调用配置，转发前确认接收人，不要提交 Git。服务端 Docker 容器设置了自动重启，嵌入后端未向外发布端口。

## 2026-11-03 验收

- 完成 856 条资料向量化，每条 4096 维；健康接口显示 `hybrid`、`vectors.ready: true`。
- 自然语言检索返回 8 条结果，使用混合检索。
- 实际 Agent 对话成功调用 `search_fault_knowledge`、`list_fault_knowledge_sources` 和 `submit_analysis`；查询证据包含 `retrieval: hybrid`。
- 接口验证：正确密钥可以生成向量，错误密钥 401，其他模型 400，聊天路径 404。
- 独立后端显示 100% GPU 推理，验收时总显存约 31.3 GB；原聊天服务保持健康。
- `npm run check` 和两项知识检索回归测试通过。受 Git 跟踪的文件中未发现本次新增服务的地址或密钥。

完整本机验收证据保存在已忽略的 `.dcma-runtime/private/embedding-acceptance.json`。尚未在同学电脑上验证网络可达性。
