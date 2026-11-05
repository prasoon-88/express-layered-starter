import type { Request, Response } from 'express';

// Registration is the JSON endpoint POST /api/v1/user/register. A browser form POST would also
// need CSRF protection, so it is added together with sessions, not before.
const signupController = {
  getSignup: (req: Request, res: Response) => {
    res.render('signup', { title: 'Signup' });
  },
};

export default signupController;
