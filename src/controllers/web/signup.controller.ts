import type { Request, Response } from 'express';

const signupController = {
  getSignup: (req: Request, res: Response) => {
    res.render('signup', { title: 'Signup' });
  },
  postSignup: (req: Request, res: Response) => {
    res.render('signup', { title: 'Signup' });
  },
};

export default signupController;
