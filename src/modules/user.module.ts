import { createUserController, type UserController } from '#controllers/api/v1/user.controller';
import { defineModule } from '#http/routes';
import { createUserRepository, type UserRepository } from '#repository/user.repository';
import { userRoutes } from '#routes/api/v1/user.routes';
import { createUserService, type UserService } from '#services/user.service';

declare module '#http/registry' {
  interface Registry {
    userRepository: UserRepository;
    userService: UserService;
    userController: UserController;
  }
}

export const userModule = defineModule({
  name: 'user',
  providers: {
    userRepository: () => createUserRepository(),
    userService: (get) => createUserService({ userRepository: get('userRepository') }),
    userController: (get) => createUserController({ userService: get('userService') }),
  },
  needs: ['userController', 'limit', 'idempotent'],
  routes: userRoutes,
});
