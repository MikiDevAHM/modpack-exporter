## Git CLI Integration

> The current git cli integration uses a portable version of git, and because of that it has limited functionality. (ex if the app is using the windows portable version of git, some one using linux cannot use it)
> so i sugest that we should allow users to configure their own git path or use the system git installation.
> or we can use a npm package that provides cross-platform git functionality without requiring a portable binary.

### Tyler Task

- [ ] Research npm packages for cross-platform git functionality (e.g., `simple-git`, `nodegit`)
- [ ] Talk to Miki first about the implementation approach
- [ ] After Miki's feedback, choose the appropriate package and implementation strategy

### Claude Task

- [ ] Implement the chosen git integration solution
- [ ] Update documentation with new git integration usage instructions
- [ ] Add error handling and fallback mechanisms for missing git installations
- [ ] Create user configuration interface for custom git path selection
