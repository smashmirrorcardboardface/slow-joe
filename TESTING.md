# Testing Guide

## Running Tests

### Quick Test Run
```bash
cd backend
npm test
```

### Watch Mode (Recommended for Development)
Jest watch mode automatically re-runs tests when files change:

```bash
cd backend
npm run test:watch
```

This will:
- Watch for file changes in `src/` and `test/` directories
- Automatically re-run tests when `.ts` files are modified
- Show only tests related to changed files (by default)
- Provide interactive options:
  - `a` - run all tests
  - `f` - run only failed tests
  - `q` - quit watch mode
  - `p` - filter by filename pattern
  - `t` - filter by test name pattern

### Coverage Report
```bash
cd backend
npm run test:cov
```

This generates a coverage report showing:
- Statement coverage
- Branch coverage
- Function coverage
- Line coverage

Coverage reports are saved to `backend/coverage/`.

## Test Structure

Tests are located alongside source files with the `.spec.ts` extension:
- `src/strategy/strategy.service.ts` → `src/strategy/strategy.service.spec.ts`
- `src/exchange/exchange.service.ts` → `src/exchange/exchange.service.spec.ts`
- etc.

## Writing Tests

### Example Test File
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MyService } from './my.service';

describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MyService],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

### Best Practices
1. **Mock external dependencies** - Use Jest mocks for database, APIs, etc.
2. **Test edge cases** - Include error scenarios and boundary conditions
3. **Keep tests focused** - One test should verify one behavior
4. **Use descriptive names** - Test names should clearly describe what they test
5. **Arrange-Act-Assert** - Structure tests with clear setup, execution, and verification

## Continuous Testing

For continuous testing during development:

1. **Terminal 1**: Run the backend in watch mode
   ```bash
   cd backend
   npm run start:dev
   ```

2. **Terminal 2**: Run tests in watch mode
   ```bash
   cd backend
   npm run test:watch
   ```

Now both your application and tests will automatically reload when you make changes!

## Current Test Coverage

- ✅ StrategyService - Core strategy logic, indicators, position sizing
- ✅ ExchangeService - Exchange interactions, lot size rounding
- ✅ OrderExecuteProcessor - Order execution, fill timeout, market order fallback
- ✅ StrategyEvaluateProcessor - Trade evaluation and enqueueing

**Total**: 42 tests passing across 4 test suites

