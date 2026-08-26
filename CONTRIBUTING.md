# 贡献指南

感谢你有兴趣给 Travel Story 提改进。

这是一个由维护者主导的、单用户自部署的开源项目。为了让改动可控、质量过关，`main` 分支**只接受合并请求（Pull Request），由维护者逐条审批**。

## 想改点东西，怎么提交

1. 使用你自己的账号 **Fork** 这个仓库。
2. 在你 Fork 的仓库里新建特性分支：

   ```bash
   git checkout -b feat/my-change
   ```

3. 完成你的改动，并跑一下基础校验：

   ```bash
   npm run typecheck
   npm run build
   ```

4. 提交到你的分支后，回到本项目仓库发起 **Pull Request**（`base: main`）。
5. 维护者会 review，可能需要你补充或调整，通过后由维护者合并。

> 即使你被邀请为协作者、有写权限，也一样请走 Pull Request——`main` 上的保护规则要求非管理员必须以 PR 形式提交。

## 提交信息规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)，便于生成可读的变更记录：

- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档
- `refactor:` 重构
- `perf:` 性能
- `test:` 测试
- `style:` 格式（不影响逻辑）

示例：`docs: add contribution guide`

## 尽量先聊聊

如果是比较大、或会改变使用方式的改动（新依赖、破坏性变更、UI 大改），建议先开一个 Issue 或到交流群讨论，避免 PR 方向与项目规划冲突。

## 交流

公众号与交流群见 [README](./README.md) 末尾。

---

PR 完成后，维护者可能根据项目规划与质量关闭未合并的请求，请理解。
