# Contributing to Audarma

Thank you for your interest in contributing to Audarma! This guide will help you get started.

## Ways to Contribute

### 1. Adapter Implementations (Most Valuable)

Help expand Audarma's ecosystem by creating adapters for popular tools:

**Databases needed:**
- Prisma adapter
- Drizzle adapter
- MongoDB adapter
- Redis adapter
- PlanetScale adapter

**LLM providers needed:**
- OpenAI adapter (GPT-4, GPT-3.5)
- Anthropic adapter (Claude)
- Google Gemini adapter
- Local LLM adapter (Ollama, llama.cpp)
- AWS Bedrock adapter

**I18n libraries needed:**
- react-i18next adapter
- FormatJS adapter
- lingui adapter

### 2. Bug Fixes

Check the [known limitations](./README.md#limitations--known-issues) and fix them:
- Add retry logic with exponential backoff
- Add error boundaries
- Add cache invalidation utilities
- Fix client-side only limitation

### 3. Documentation

- Improve installation guides
- Add more usage examples
- Create video tutorials
- Translate docs to other languages

### 4. Testing

- Add unit tests
- Add integration tests
- Add E2E tests
- Test with different databases and LLMs

## Development Setup

### Prerequisites

- Node.js 20+
- npm, pnpm, or yarn
- Git

### Clone and Install

```bash
# Fork the repo on GitHub first, then:
git clone https://github.com/YOUR_USERNAME/audarma.git
cd audarma
npm install
```

### Build

```bash
npm run build
```

This compiles TypeScript to `dist/` folder.

### Development Mode

```bash
npm run dev
```

This watches for changes and rebuilds automatically.

### Type Checking

```bash
npm run type-check
```

## Testing Your Changes Locally

### Option 1: npm link

```bash
# In audarma directory
npm link

# In your test project
npm link audarma
```

### Option 2: npm pack

```bash
# In audarma directory
npm pack

# This creates audarma-0.1.0-alpha.0.tgz
# In your test project
npm install /path/to/audarma-0.1.0-alpha.0.tgz
```

## Code Style

### TypeScript

- Use strict mode
- Export all public types
- Add JSDoc comments for public APIs
- Prefer interfaces over types for public APIs

### React Components

- Use functional components
- Use hooks (no class components)
- Export named components, not default
- Add TypeScript types for all props

### Naming Conventions

- Components: `PascalCase` (e.g., `AudarProvider`)
- Functions: `camelCase` (e.g., `useViewTranslation`)
- Types/Interfaces: `PascalCase` (e.g., `AudarConfig`)
- Files: `kebab-case` (e.g., `view-translation-provider.tsx`)

### Example Code Style

```typescript
/**
 * Creates a database adapter for PostgreSQL
 *
 * @param client - PostgreSQL client instance
 * @returns DatabaseAdapter implementation
 */
export function createPostgresAdapter(client: Client): DatabaseAdapter {
  return {
    async getCachedTranslations(items, targetLocale) {
      // Implementation
    },

    async saveTranslations(translations) {
      // Implementation
    }
  };
}
```

## Pull Request Process

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

Branch naming:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `test/` - Test additions

### 2. Make Your Changes

- Write clear, descriptive commit messages
- Keep commits focused (one logical change per commit)
- Add tests if applicable
- Update documentation if needed

### 3. Test Thoroughly

```bash
# Type check
npm run type-check

# Build
npm run build

# Test in a real project (npm link or npm pack)
```

### 4. Commit Your Changes

```bash
git add .
git commit -m "feat: add Prisma database adapter

- Implement getCachedTranslations
- Implement saveTranslations
- Add TypeScript types
- Add usage example in README"
```

Commit message format:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then open a PR on GitHub with:

**Title**: Clear, concise description (e.g., "Add Prisma database adapter")

**Description**:
```markdown
## What

Brief description of what this PR does.

## Why

Why is this change needed? What problem does it solve?

## How

How did you implement the solution?

## Testing

How did you test this? Include steps to reproduce.

## Checklist

- [ ] Code follows style guidelines
- [ ] Types are properly defined
- [ ] Documentation updated
- [ ] Tested locally
- [ ] No breaking changes (or clearly documented)
```

### 6. Review Process

- Maintainers will review your PR
- Address any feedback or requested changes
- Once approved, maintainers will merge

## Adding a New Adapter

### File Structure

```
src/adapters/examples/
└── your-adapter-name.ts
```

### Template

```typescript
import { DatabaseAdapter, TranslationItem, CachedTranslation } from '../../types';
// Import your library here

/**
 * Creates a [YOUR_SERVICE] adapter for Audarma
 *
 * @param config - Configuration for [YOUR_SERVICE]
 * @returns DatabaseAdapter implementation
 *
 * @example
 * ```typescript
 * import { create[YourService]Adapter } from 'audarma/adapters/examples/your-service';
 *
 * const adapter = create[YourService]Adapter({
 *   // configuration
 * });
 * ```
 */
export function createYourServiceAdapter(config: YourConfig): DatabaseAdapter {
  return {
    async getCachedTranslations(
      items: TranslationItem[],
      targetLocale: string
    ): Promise<CachedTranslation[]> {
      // Implementation
    },

    async saveTranslations(translations: Array<{
      contentType: string;
      contentId: string;
      locale: string;
      originalText: string;
      translatedText: string;
      sourceHash: string;
    }>): Promise<void> {
      // Implementation
    }
  };
}
```

### Documentation

Add usage example to README.md:

```markdown
### YourService

```typescript
import { createYourServiceAdapter } from 'audarma/adapters/examples/your-service';

const adapter = createYourServiceAdapter({
  // configuration
});
```

## Project Structure

```
audarma/
├── src/
│   ├── core/                 # Core implementation
│   │   ├── AudarProvider.tsx
│   │   └── ViewTranslationProvider.tsx
│   ├── types/                # TypeScript definitions
│   │   └── index.ts
│   ├── adapters/
│   │   └── examples/         # Reference adapter implementations
│   │       ├── supabase-adapter.ts
│   │       ├── nebius-llm-provider.ts
│   │       └── next-intl-adapter.ts
│   └── index.ts              # Package entry point
├── cli/                      # CLI tool (WIP)
│   └── translate.ts
├── docs/                     # Documentation
│   └── dual-mode-translation.md
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE
├── package.json
└── tsconfig.json
```

## Communication

- **GitHub Issues** - Bug reports, feature requests
- **GitHub Discussions** - Questions, ideas, general discussion
- **Pull Requests** - Code contributions

## Code of Conduct

### Be Respectful

- Respect different viewpoints and experiences
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards other contributors

### Be Professional

- Use welcoming and inclusive language
- Be patient with newcomers
- Help others learn and grow
- Give credit where credit is due

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

- Open a [GitHub Discussion](https://github.com/audarma/audarma/discussions)
- Check existing [Issues](https://github.com/audarma/audarma/issues)
- Review the [README](./README.md)

Thank you for contributing to Audarma!
